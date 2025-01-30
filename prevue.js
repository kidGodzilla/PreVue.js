(() => {
    const assignDeep = (elm, props) => Object.entries(props).forEach(([key, value]) =>
        typeof value === 'object' ? assignDeep(elm[key], value) : Object.assign(elm, {[key]: value})
    );

    const tagNames = ['a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset','figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins','kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr'].forEach(tag => window[tag] = function(...args) {
        const props = typeof args[0] == 'object' && !(args[0] instanceof HTMLElement) ? args.shift() : null;
        const elm = document.createElement(tag);
        if (props) assignDeep(elm, props);
        elm.append(...args.map(a => typeof a == 'string' ? document.createTextNode(a) : a));
        return elm;
    });

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
        let lastIfPlaceholder = null; // Track last v-if

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
                } else if (attr.name === "v-model") {
                    props["v-model"] = attr.value.trim();
                } else if (attr.name === "v-if") {
                    const expression = attr.value;
                    props["v-if"] = {
                        expression,
                        getValue: () => new Function("with(this) { return " + expression + "; }").call(state)
                    };
                } else if (attr.name === "v-else") {
                    props["v-else"] = true;
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
                    lastIfPlaceholder = placeholder; // Store for v-else

                    const update = () => {
                        const shouldShow = getValue();
                        if (shouldShow && !currentElement) {
                            delete props["v-if"];
                            currentElement = buildElement({ tag, props, children });
                            placeholder.parentNode?.insertBefore(currentElement, placeholder);
                        } else if (!shouldShow && currentElement) {
                            currentElement.remove();
                            currentElement = null;
                        }
                    };

                    const dependencies = expression.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
                    dependencies.forEach(dep => {
                        state.addUpdate(dep, update);
                    });

                    setTimeout(update, 0);
                    return placeholder;
                }

                if (props && props["v-else"]) {
                    if (!lastIfPlaceholder) {
                        console.error("v-else used without v-if");
                        return document.createComment(" v-else error ");
                    }

                    const placeholder = document.createComment(" v-else ");
                    let currentElement = null;
                    const prevIfPlaceholder = lastIfPlaceholder;
                    lastIfPlaceholder = null;

                    const update = () => {
                        // Get the opposite of the v-if condition
                        const shouldShow = !prevIfPlaceholder.previousElementSibling;
                        if (shouldShow && !currentElement) {
                            delete props["v-else"];
                            currentElement = buildElement({ tag, props, children });
                            placeholder.parentNode?.insertBefore(currentElement, placeholder);
                        } else if (!shouldShow && currentElement) {
                            currentElement.remove();
                            currentElement = null;
                        }
                    };

                    setTimeout(update, 0);
                    
                    // Setup observer after initial render
                    setTimeout(() => {
                        if (placeholder.parentNode) {
                            const observer = new MutationObserver(update);
                            observer.observe(placeholder.parentNode, { childList: true });
                        }
                    }, 0);

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
                        } else if (key === "v-model") {
                            const stateProp = props[key];
                            elm.value = state[stateProp];

                            // Update state when input changes
                            elm.addEventListener("input", (event) => {
                                state[stateProp] = event.target.value;
                            });

                            // Update input value when state changes
                            state.addUpdate(stateProp, () => {
                                elm.value = state[stateProp];
                            });
                        }
                    }
                }

                return elm;
            };

            return buildElement(convertNode(dom.firstElementChild));
        };
    };

    // Auto-initialization
    (document.readyState === "loading"
            ? cb => document.addEventListener("DOMContentLoaded", cb)
            : cb => cb()
    )(() => {
        window.setup?.();
        document.querySelectorAll("template").forEach(template => {
            const Component = parseHTMLToJS(template.innerHTML, window.state);
            const element = Component();
            if (element instanceof Node) {
                template.replaceWith(element);
            } else {
                console.error("Component did not return a valid DOM node", element);
            }
        });
    });
})();
