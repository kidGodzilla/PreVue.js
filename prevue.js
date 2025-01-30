(() => {
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
