import { GenericSearchEngine } from "./searchEngine";
import { ISearchResultLink } from "./interfaces";
import { DEBUG_MODE } from "../../BDTLLCommon";

const UrlSelectors: string[] = [
    "div#cols .compTitle h1 a",
    "div#cols .compTitle h2 a",
    "div#cols .compTitle h3 a",
    "div#cols .compTitle h4 a",
    "div#cols .compTitle h5 a",
    "div#cols .compTitle h6 a",
    "div#cols .compList a",
    "div#cols .compTitle a",
    "div#cols .compText.lh-s a",
    // It like this is used only for jp "#contents__wrap .sw-CardBase .sw-Card__title a",
    "a.citation-link"
]

export class Yahoo extends GenericSearchEngine {
    constructor() {
        super();
        this.UrlSelectors = UrlSelectors.join();
    }

    processAnchor(element: HTMLElement): HTMLElement {
        let result: HTMLElement = element.querySelector("h3 > span");

        result = result || element;

        return result;
    }

    async handleElementMutation(node: Node): Promise<void> {
        const extractedLinks: ISearchResultLink[] = this.extractLinks(node as HTMLElement | Document, false);
        let newLinks: ISearchResultLink[] = [];

        extractedLinks.forEach(async link => {
            if (link.element.classList.contains("citation-link")) {
                super.removeOldTooltip(link.element);
                const result: ISearchResultLink = (await this.searchAnalyzer.scanLinks([link]))[0];
                this.searchAnalyzer.renderStatus(result, link.element);
                return;
            }

            if (!this.previousLinkURLs.has(link.element)) {
                newLinks.push(link);
                this.previousLinkURLs.add(link.element);
            }
        });

        if (newLinks.length > 0) {
            newLinks = await this.searchAnalyzer.scanLinks(newLinks);
            this.searchAnalyzer.renderStatuses(newLinks);
        }
    }

    protected getElementUrl(element: HTMLElement, checkDuplicates: boolean): string {
        let url: string = super.getElementUrl(element, checkDuplicates);

        if (!url) {
            return undefined;
        }

        try {
            const urlObj: URL = new URL(url);

            if (urlObj.hostname === 'r.search.yahoo.com') {
                const pathParts = urlObj.pathname.split('/');
                for (const part of pathParts) {
                    if (part.startsWith('RU=')) {
                        return decodeURIComponent(part.substring(3));
                    }
                }
            }
        } catch (e) {
            if (DEBUG_MODE) {
                console.error('Failed to process Yahoo URL:', url, e);
            }
        }

        return url;
    }

    insertAndStyleTooltipContainer(anchor: HTMLElement, container: HTMLElement): void {
        super.insertAndStyleTooltipContainer(anchor, container);

        if (anchor.closest("div[class*='genAISum'], div.citationsTooltip")) {
            container.style.marginRight = "3%";
            anchor.insertBefore(container, anchor.firstElementChild);
        }
    }
}