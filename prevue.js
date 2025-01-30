(() => {
    const assignDeep = (elm, props) => Object.entries(props).forEach(([key, value]) =>
        typeof value === 'object' ? assignDeep(elm[key], value) : Object.assign(elm, {[key]: value})
    );

    const tagNames = ['a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset','figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins','kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr'].forEach(tag => window[tag] = function(...args) {
        const props = typeof args[0] == 'object' && !(args[0] instanceof HTMLElement) ? args.shift() : null;
        const elm = document.createElement(tag);
        props && assignDeep(elm, props);

        // Handle @click and v-if
        if (props) {
            Object.entries(props).forEach(([key, value]) => {
                if (key.startsWith('@')) {
                    elm.addEventListener(key.slice(1), value);
                } else if (key === 'v-if' && !value) {
                    elm.style.display = 'none';
                }
            });
        }

        elm.append(...args.map(a => typeof a == 'string' ? document.createTextNode(a) : a));
        return elm;
    });

    window.$ = selector => document.querySelector(selector);
    window.$$ = selector => Array.from(document.querySelectorAll(selector));

    window.createState = state => {
        const appState = { ...state };
        appState._updates = Object.fromEntries(Object.keys(state).map(s => [s, []]));
        appState._update = s => appState._updates[s].forEach(u => u());
        appState.addUpdate = (s, u) => appState._updates[s].push(u);
        return new Proxy(appState, {
            set(o, p, v) { o[p] = v; o._update(p); return true; }
        });
    };

    window.mount = (component, container) => {
        container.innerHTML = '';
        container.appendChild(component());
    };

    window.parseHTMLToJS = (html, state) => {
        const dom = new DOMParser().parseFromString(html, "text/html").body;

        const convertNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const textContent = node.textContent.trim();

                // Check for {{ variable }} bindings
                if (textContent.includes("{{") && textContent.includes("}}")) {
                    const expression = textContent.match(/{{(.*?)}}/)[1].trim(); // Extract variable

                    const getValue = () => {
                        try {
                            return new Function("with(this) { return " + expression + "; }").call(state);
                        } catch (e) {
                            console.error(`Failed to evaluate: {{ ${expression} }}`, e);
                            return "";
                        }
                    };

                    const textNode = document.createTextNode(getValue());

                    // Auto-update when state changes
                    state.addUpdate(expression, () => {
                        textNode.textContent = getValue();
                    });

                    return textNode;
                }

                return textContent;
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return null;

            const tag = node.tagName.toLowerCase();
            const props = {};
            const children = Array.from(node.childNodes).map(convertNode).filter(Boolean);

            for (const attr of node.attributes) {
                if (attr.name.startsWith("@")) {
                    const eventName = attr.name.slice(1);
                    props[`@${eventName}`] = new Function("event", `with(this) { ${attr.value} }`).bind(state);
                } else if (attr.name === "v-if") {
                    const expression = attr.value;
                    props["v-if"] = {
                        expression,
                        getValue: () => new Function("with(this) { return " + expression + "; }").call(state)
                    };
                } else {
                    props[attr.name] = attr.value;
                }
            }

            return { tag, props, children };
        };

        return () => {
            const buildElement = ({ tag, props, children }) => {
                if (props && props["v-if"]) {
                    const { expression, getValue } = props["v-if"];
                    const placeholder = document.createComment(` v-if: ${expression} `);
                    let currentElement = null;

                    const update = () => {
                        const shouldShow = getValue();
                        if (shouldShow && !currentElement) {
                            // Create and show element
                            delete props["v-if"]; // Remove v-if to prevent recursion
                            currentElement = buildElement({ tag, props, children });
                            placeholder.parentNode?.insertBefore(currentElement, placeholder);
                        } else if (!shouldShow && currentElement) {
                            // Remove element
                            currentElement.remove();
                            currentElement = null;
                        }
                    };

                    // Register for updates
                    const dependencies = expression.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
                    dependencies.forEach(dep => {
                        state.addUpdate(dep, update);
                    });

                    // Initial render
                    setTimeout(update, 0);
                    return placeholder;
                }

                const elm = window[tag] ? window[tag](props, ...children.map(c => {
                    if (c instanceof Node) {
                        return c;
                    }
                    return typeof c === "string" ? c : buildElement(c);
                })) : document.createElement(tag);

                if (props) {
                    for (const key in props) {
                        if (key.startsWith("@")) {
                            const eventName = key.slice(1);
                            elm.addEventListener(eventName, props[key]);
                        }
                    }
                }

                return elm;
            };

            return buildElement(convertNode(dom.firstElementChild));
        };
    };

    (function (callback) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", callback);
        } else {
            callback();
        }
    })(function () {
        // console.log("Document is ready!");

        if (window.setup) window.setup();

        document.querySelectorAll("template").forEach(template => {
            const Component = parseHTMLToJS(template.innerHTML, window.state);
            template.replaceWith(Component());
        });
    });
})();
