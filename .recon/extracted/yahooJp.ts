import { GenericSearchEngine } from "./searchEngine";

const UrlSelectors: string[] = [
    "#contents__wrap .sw-CardBase .sw-Card__title a"
]

export class YahooJp extends GenericSearchEngine {
    constructor() {
        super();
        this.UrlSelectors = UrlSelectors.join();
    }

    processAnchor(element: HTMLElement): HTMLElement {
        let result: HTMLElement = element.querySelector("h3");
        return result || element;
    }

    insertAndStyleTooltipContainer(anchor: HTMLElement, container: HTMLElement): void {
        super.insertAndStyleTooltipContainer(anchor, container);
        anchor.insertBefore(container, anchor.firstChild);
        anchor.style.display = "flex";
    }
}