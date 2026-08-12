import { GenericSearchEngine } from "./searchEngine";

const UrlSelectors: string[] = [
    // "a.result__a:not(.related-searches a)",
    'a[data-testid="result-title-a"]',
    'li[id*="sl"] > a',
    ".sponsored__sitelink",
    "div[data-testid='duckassist-answer-content'] a",
    "div[data-testid='duckassist-expanded-answer-content'] + span a"
]

export class DuckDuckGo extends GenericSearchEngine {
    constructor() {
        super();
        this.UrlSelectors = UrlSelectors.join();
    }

    processAnchor(element: HTMLElement): HTMLElement {
        return element;
    }

    insertAndStyleTooltipContainer(anchor: HTMLElement, container: HTMLElement): void {
        super.insertAndStyleTooltipContainer(anchor, container);

        if (
            anchor.closest("div[data-testid='duckassist-answer-content']") ||
            anchor.closest("div[data-testid='duckassist-expanded-answer-content'] + span")
        ) {
            container.style.display = "inline-block";
            container.style.float = "none";
            container.style.transform = "translateY(15%)";
        }
    }
}