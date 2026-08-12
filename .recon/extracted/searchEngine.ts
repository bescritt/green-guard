import { Utils } from "../../BDTLLCommon";
import { ISearchResultLink, ISearchAnalyzer } from "./interfaces";

export abstract class GenericSearchEngine {
    searchAnalyzer: ISearchAnalyzer
    previousLinkURLs: WeakSet<HTMLElement>;
    UrlSelectors: string;
    urlIdCounter: number;

    static defaultTooltipStyles: Partial<CSSStyleDeclaration> = {
        display: "inline",
        zIndex: "1",
        float: "left"
    };

    constructor() {
        this.previousLinkURLs = new WeakSet<HTMLElement>;
        this.urlIdCounter = 0;

        const observer: MutationObserver = new MutationObserver(async (mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "attributes" && mutation.attributeName === "href") {
                    const element: HTMLElement = mutation.target as HTMLElement;
                    await this.handleUrlChange(element);
                    continue;
                }

                if (mutation.type !== "childList" || mutation.target.nodeName === "STYLE") {
                    continue;
                }

                mutation.addedNodes.forEach(async (addedNode) => {
                    const node = addedNode as HTMLElement;
                    if (
                        node.nodeName === "#text" ||
                        node.nodeName === "#comment" ||
                        node.id?.startsWith("BDTLL_") ||
                        node.classList?.contains("BDTLL_Container") ||
                        node.querySelector?.("[id^='BDTLL_'],.BDTLL_Container")
                    ) {
                        return;
                    }

                    await this.handleElementMutation(addedNode);
                });
            }
        });

        observer.observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["href"]
        });
    }

    abstract processAnchor(element: HTMLElement): HTMLElement;

    async handleUrlChange(element: HTMLElement): Promise<void> {
        if (element.id?.startsWith("BDTLL_") || element.classList?.contains("BDTLL_Container")) {
            return;
        }

        this.removeOldTooltip(element);
        await this.handleElementMutation(element.parentElement);
        return;
    }

    extractLinks(node: Document | HTMLElement, checkDuplicates: boolean = true): ISearchResultLink[] {
        const criteria: string = this.UrlSelectors;
        const processExtractedElementCallback = (urlElement: HTMLElement) => {
            if (checkDuplicates && this.previousLinkURLs.has(urlElement)) {
                return;
            }

            const url: string = this.getElementUrl(urlElement, checkDuplicates);
            if (!url) {
                return;
            }

            const anchorElement: HTMLElement = this.processAnchor(urlElement);
            const container: HTMLElement = document.createElement("div");
            this.insertAndStyleTooltipContainer(anchorElement, container);

            return {
                url: url,
                container: container,
                element: urlElement
            };
        };

        if (node instanceof HTMLElement && node.matches(criteria)) {
            const link: ISearchResultLink = processExtractedElementCallback(node);
            return link? [link] : [];
        }

        const genericUrls: NodeListOf<Element> = node.querySelectorAll(criteria);
        return Array.from(genericUrls).map(processExtractedElementCallback).filter(Boolean);
    }

    insertAndStyleTooltipContainer(anchor: HTMLElement, container: HTMLElement): void {
        Object.assign(container.style, GenericSearchEngine.defaultTooltipStyles);
        anchor.parentElement.insertBefore(container, anchor);
    }

    protected getElementUrl(element: HTMLElement, checkDuplicates: boolean): string {
        if (checkDuplicates) {
            if (
                element.parentElement?.id?.startsWith("BDTLL_") ||
                element.previousElementSibling?.id?.startsWith("BDTLL_")
            ) {
                return undefined;
            }

            const divChildNodes: HTMLElement[] = Array.from(
                element.querySelectorAll("div[id]") as NodeListOf<HTMLElement>
            );
            if (divChildNodes !== null) {
                for (const divNode of divChildNodes) {
                    if (divNode == null || divNode.id == null) {
                        continue;
                    }

                    if (divNode.id.startsWith("BDTLL_")) {
                        return undefined;
                    }
                }
            }
        }

        let url: string = (element as HTMLAnchorElement).href;

        if (element.hasAttribute("data-preconnect-urls")) {
            url = element.dataset.preconnectUrls;
        }

        if (element.hasAttribute("data-href")) {
            url = element.dataset.href;
        }

        if (!url || !Utils.validURL(url)) {
            return undefined;
        }

        return url;
    }

    async handleElementMutation(node: Node): Promise<void> {
        const extractedLinks: ISearchResultLink[] = this.extractLinks(node as Document | HTMLElement);
        let newLinks: ISearchResultLink[] = [];

        extractedLinks.forEach(async link => {
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

    removeOldTooltip(element: HTMLElement): void {
        const previousTooltip: HTMLElement = element.querySelector("div[id^=BDTLL_]");

        if (previousTooltip) {
            const idCounter: string = previousTooltip.id.split("_")[1];
            const previousPopup: HTMLElement | null = document.querySelector(`div[id='TLL_${idCounter}']`);

            previousPopup?.parentElement?.remove();
            previousTooltip.remove();
            this.previousLinkURLs.delete(element);
        }
    }
}