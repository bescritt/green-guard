import { GenericSearchEngine } from "./searchEngine";

const UrlSelectors: string[] = [
    "a.l",
    ".s > .r > a",
    ".g > * > .r > a",
    ".g > .r > a",
    ".rc > .r > a",
    ".rc > div > a",
    ".pslimain > .r > a",
    ".g > a",
    ".gs_rt > a",
    "p > a.on",
    ".vsc .vsta a",
    "li.ads-ad h3 > a:last-child",
    "li > h3 > a[id~=vads]",
    ".DOqJne > g-link > a",
    // Google ads top of the search results
    'div.pla-unit div.pla-unit-title a.pla-unit-title-link',
    '#tads      a:not([style*="display:none"])' +
                ':not([class*="aob"]):not([class*="plantl"]):not([class*="uXOYmb"])' +
                ':not([class*="h1vhpc"]):not([class*="ropLT"]):not([class*="AY4i3c"])' +
                ':not(div.bOeY0b a):not(div.Qezod a):not(div.Vn4Xqe a):not(div.ifk4y a)' +
                ':not(div.goog-tooltip a):not(div.pla-extensions-container a):not(div.Gor6zc):not(div.SuXxEf a):not(div.uhLbob a)',
    // Google ads bottom of the search results
    '#bottomads a:not([class*="aob"]):not(div.bOeY0b a):not(div.Qezod a):not(div.Vn4Xqe a):not(div.ifk4y a):not(div.SuXxEf a)',
    '#search div.yuRUbf a:first-child', // Removed 'div.tF2Cxc' because it was too strong.
    '#search div.yuRUbf > div > a',
    '#search div.M42dy g-link > a',
    '#search div.ct3b9e > a',
    // Continous scrolling
    '#botstuff div.yuRUbf > a',
    '#botstuff div.yuRUbf > div > span > a',
    '#botstuff div.uEierd div.v5yQqb > a',
    // AI Overview
    'div[data-subtree][jsmodel] a',
    'div[data-ve-view] div[jsmodel] a'
]

export class Google extends GenericSearchEngine {
    constructor() {
        super();
        this.UrlSelectors = UrlSelectors.join();
    }

    processAnchor(element: HTMLElement): HTMLElement {
        let result: HTMLElement = element.querySelector("h3");

        if (result !== null) {
            if (result.children.length > 0 &&
                (result.children[0]?.id?.startsWith("BDTLL_")) ||
                (result.children[0]?.classList?.contains("BDTLL_Container"))
            ) {
                result = result.children[0] as HTMLElement;
            }
            else {
                const span: HTMLElement = document.createElement("span");
                span.classList.add("BDTLL_Container");
                result.insertBefore(span, result.firstChild);
                result = span;
            }
        }

        result = result || element.querySelector("span:not(cite > span):not(span > span)");
        result = result || element;

        if (
            element.hasAttribute("ping") &&
            (element.closest("[data-rl], [data-sfc-cp]") ||
                element.parentElement instanceof HTMLLIElement)
        ) {
            const nextSibling = element.nextElementSibling;
            result = (nextSibling?.firstElementChild as HTMLElement) || result;
        }

        return result;
    }

    insertAndStyleTooltipContainer(anchor: HTMLElement, container: HTMLElement): void {
        super.insertAndStyleTooltipContainer(anchor, container);

        if (anchor.closest("[data-rl], [data-sfc-cp]")) {
            container.style.float = "none";
        }

        if (anchor.parentElement instanceof HTMLLIElement) {
            container.style.float = "left";

            const cardInfoHolder: HTMLDivElement = document.createElement("div");
            let maxPadding: number = 12;

            Array.from(anchor.parentElement.children).forEach(child => {
                if (child === anchor || child === container) {
                    return;
                }

                const childPadding: string = window.getComputedStyle(child).getPropertyValue("padding");
                const convertedPadding: number = parseFloat(childPadding);

                if (convertedPadding > maxPadding) {
                    maxPadding = convertedPadding;
                }

                cardInfoHolder.appendChild(child);
            });

            cardInfoHolder.style.display = "flex";
            cardInfoHolder.style.flexDirection = "row";

            container.style.padding = `${maxPadding}px`;
            container.style.paddingRight = "0%";
            container.style.marginRight = "-1%";

            cardInfoHolder.insertBefore(container, cardInfoHolder.firstElementChild);
            anchor.parentElement.appendChild(cardInfoHolder);
        }

        if (anchor.closest("li > a + div")) {
            container.style.marginRight = "2%";

            const localRoot: HTMLElement = anchor.closest("li > a + div");
            const cardInfoHolder: HTMLDivElement = document.createElement("div");
            Array.from(localRoot.children).forEach(child => {
                if (child === container) {
                    return;
                }

                cardInfoHolder.appendChild(child);
            });

            localRoot.style.flexDirection = "row";
            localRoot.appendChild(container);
            localRoot.appendChild(cardInfoHolder);
        }
    }
}