(() => {
    const assignDeep = (target, source) => {
        Object.entries(source).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                assignDeep(target[key] || (target[key] = {}), value);
            } else {
                target[key] = value;
            }
        });
    };

    const tagNames = [
        'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base',
        'bdi', 'bdo', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption',
        'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del',
        'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset',
        'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
        'h5', 'h6', 'head', 'header', 'hr', 'html', 'i', 'iframe', 'img',
        'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map',
        'mark', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup',
        'option', 'output', 'p', 'param', 'picture', 'pre', 'progress', 'q',
        'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select',
        'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
        'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead',
        'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr'
    ];

    tagNames.forEach(tag => {
        window[tag] = function(props = {}, ...children) {
            const element = document.createElement(tag);
            assignDeep(element, props);

            Object.entries(props).forEach(([key, value]) => {
                if (key.startsWith('@')) {
                    element.addEventListener(key.slice(1), value);
                } else if (key === 'v-if' && !value) {
                    element.style.display = 'none';
                }
            });

            children.forEach(child => {
                if (typeof child === 'string') {
                    element.appendChild(document.createTextNode(child));
                } else if (child instanceof Node) {
                    element.appendChild(child);
                }
            });

            console.log(`Created <${tag}> element`);
            return element;
        };
    });

    window.createState = (initialState) => {
        const state = { ...initialState, _updates: {} };

        state._updates = Object.fromEntries(
            Object.keys(initialState).map(key => [key, []])
        );

        state._update = (key) => {
            state._updates[key].forEach(callback => callback());
        };

        state.addUpdate = (key, callback) => {
            if (state._updates[key]) {
                state._updates[key].push(callback);
            }
        };

        return new Proxy(state, {
            set(target, prop, value) {
                target[prop] = value;
                target._update(prop);
                return true;
            }
        });
    };

    window.mount = (component, container) => {
        container.innerHTML = '';
        container.appendChild(component());
    };

    window.parseHTMLToJS = (html, state) => {
        const parser = new DOMParser();
        const dom = parser.parseFromString(html, "text/html").body.firstChild;

        const buildElement = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const matches = node.textContent.match(/{{\s*(\w+)\s*}}/);
                if (matches) {
                    const textNode = document.createTextNode(state[matches[1]]);
                    state.addUpdate(matches[1], () => {
                        textNode.textContent = state[matches[1]];
                    });
                    return textNode;
                }
                return document.createTextNode(node.textContent);
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return null;

            const { tagName, attributes, childNodes } = node;
            const props = {};
            const children = [];

            Array.from(attributes).forEach(attr => {
                if (attr.name.startsWith('@')) {
                    props[attr.name] = new Function('event', `with(this) { ${attr.value} }`).bind(state);
                } else if (attr.name === 'v-if') {
                    props['v-if'] = attr.value;
                } else {
                    props[attr.name] = attr.value;
                }
            });

            Array.from(childNodes).forEach(child => {
                const builtChild = buildElement(child);
                if (builtChild) children.push(builtChild);
            });

            if (props['v-if']) {
                const placeholder = document.createComment(`v-if: ${props['v-if']}`);
                const updateVisibility = () => {
                    const shouldDisplay = new Function(`with(this) { return ${props['v-if']}; }`).call(state);
                    console.log(`v-if "${props['v-if']}": shouldDisplay = ${shouldDisplay}`);
                    const nodeClone = node.cloneNode(true);
                    nodeClone.removeAttribute('v-if');
                    const builtElement = buildElement(nodeClone);
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(shouldDisplay ? builtElement : document.createComment(''), placeholder);
                    }
                };
                state.addUpdate(props['v-if'], updateVisibility);
                updateVisibility();
                return placeholder;
            }

            if (!window[tagName.toLowerCase()]) {
                console.error(`Undefined tag function for <${tagName}>`);
                return document.createComment(`Undefined tag: ${tagName}`);
            }

            return window[tagName.toLowerCase()](props, ...children);
        };

        return () => buildElement(dom);
    };

    document.addEventListener("DOMContentLoaded", () => {
        window.setup?.();
        document.querySelectorAll("template").forEach(template => {
            const component = window.parseHTMLToJS(template.innerHTML, window.state);
            const element = component();
            if (element instanceof Node) {
                template.replaceWith(element);
            } else {
                console.error("Component did not return a valid DOM node", element);
            }
        });
    });
})();
