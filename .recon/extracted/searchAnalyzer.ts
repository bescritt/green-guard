import * as React from "react";
import * as ReactDOM from "react-dom";
import * as BDTLL from "../../BDTLLCommon";
import { StatusTooltip } from "../../pages/components/statusTooltip";
import { AnalyzerPageStatus } from "../../pages/analyzerPopup/analyzerPageStatus";
import { ISearchResultLink, INodeAttributes, ISearchAnalyzer } from "./interfaces";
import { SearchEngineFactory } from "./searchEngineFactory";
import { GenericSearchEngine } from "./searchEngine";

class SearchAnalyzer implements ISearchAnalyzer {
    userWhitelist: Array<string>;
    sessionWhitelist: Array<string>;
    advancedThreatFilterStatus: boolean;
    searchResultsProcessor: GenericSearchEngine;

    constructor() {
        if ((window as any).__BDTLL_SEARCH_ANALYZER_INITIALIZED__) {
            return;
        }

        (window as any).__BDTLL_SEARCH_ANALYZER_INITIALIZED__ = true;

        this.searchResultsProcessor = SearchEngineFactory.getSearchEngineAnalyzer();
        this.searchResultsProcessor.searchAnalyzer = this;
        this.analyzeSearchResults();
    }

    async analyzeSearchResults(): Promise<void> {
        await this.getWhitelist();
        await this.getSessionWhitelist();
        await this.getAdvancedThreatFilterStatus();

        let links: ISearchResultLink[] = this.searchResultsProcessor.extractLinks(document);
        if (links.length === 0) {
            return;
        }

        links = await this.scanLinks(links);
        links.forEach(link => {
            this.searchResultsProcessor.previousLinkURLs.add(link.element);
        });
        this.renderStatuses(links);
    }

    async getWhitelist(): Promise<void> {
        this.userWhitelist = await whitelist;
    }

    async getSessionWhitelist(): Promise<void> {
        this.sessionWhitelist = await sessionWhitelist;
    }

    async getAdvancedThreatFilterStatus(): Promise<void> {
        this.advancedThreatFilterStatus = await tf;
    }

    async scanLinks(links: ISearchResultLink[]): Promise<ISearchResultLink[]> {
        const requests: string[] = links.map(l => { return l.url });
        const response: BDTLL.PageStatus[] = await BDTLL.MessageService.messageBackground({
            command: BDTLL.Command.SCAN_LINKS,
            urls: requests
        }) as BDTLL.PageStatus[];

        if (BDTLL.DEBUG_MODE) {
            console.log("Sent message with requests");
        }
        for (const id in requests) {
            links[id].request = requests[id];
            const domain: string = BDTLL.Utils.extractRootDomain(links[id].url);

            // Check if the link should be scanned or not. If yes, first check if the url is in the user whitelist or not.
            if (!this.advancedThreatFilterStatus) {
                links[id].response = BDTLL.PageStatus.DISABLED;
            } else if (this.userWhitelist.indexOf(domain) > -1) {
                links[id].response = BDTLL.PageStatus.WHITELISTED;
            } else if (this.sessionWhitelist.indexOf(domain) > -1) {
                links[id].response = BDTLL.PageStatus.SESSION_WHITELISTED;
            } else {
                if (response[id] === BDTLL.PageStatus.MALVERTISING) {
                    // Check with the service if malvertising is enabled
                    const isEnabled: boolean = await BDTLL.MessageService.messageBackground({
                        command: BDTLL.Command.CHECK_MALVERTISING_ENABLED,
                    }) as boolean;
                    if (!isEnabled) {
                        links[id].response = BDTLL.PageStatus.SAFE;
                        continue;
                    }
                }

                links[id].response = response[id] as BDTLL.PageStatus;
            }
        }

        if (BDTLL.DEBUG_MODE) {
            console.log("Got repsonses");
            console.log(links);
        }

        return links;
    }

    renderStatuses(links: ISearchResultLink[]): void {
        for(const link of links) {
            try {
                const anchor: HTMLElement = link.element;
                const prevSibling = anchor.previousElementSibling;
                const nextSibling = anchor.nextElementSibling;

                if (anchor.querySelector("[id^='BDTLL_']")) {
                    continue;
                }

                if (prevSibling?.id?.startsWith("BDTLL_") || prevSibling?.classList?.contains("BDTLL_Container")) {
                    continue;
                }

                if (nextSibling?.id?.startsWith("BDTLL_") || nextSibling?.classList?.contains("BDTLL_Container")) {
                    continue;
                }

                this.renderStatus(link, anchor);
            } catch (error) {
                console.log("Render statuses:", error);
            }
        }
    }

    renderStatus(link: ISearchResultLink, anchor: HTMLElement): void {
        const id: number = this.searchResultsProcessor.urlIdCounter++;
        const statusTooltipNode: HTMLElement = this.renderStatusTooltip(id, link);
        this.renderStatusPopup(id, link);

        if (anchor.parentElement?.id?.startsWith("sl-")) {
            // It happens for some of the results on duckduckgo search engine.
            statusTooltipNode.style.float = null;
        }

        statusTooltipNode.addEventListener('mouseout', () => {
            const popup: HTMLElement = document.getElementById(`TLL_${id}`);
            if (popup !== undefined) {
                popup.style.display = "none";
                popup.parentElement.style.display = "none";
            }
        });

        statusTooltipNode.addEventListener('mouseover', () => {
            const rect: DOMRect = statusTooltipNode.getBoundingClientRect();
            const popup: HTMLElement = document.getElementById(`TLL_${id}`);
            if (popup !== undefined) {
                popup.style.display = "block";
                popup.style.left = (rect.left + window.scrollX).toFixed(0) + "px";
                popup.style.top = (rect.top + window.scrollY + 22).toFixed(0) + "px";
                popup.parentElement.style.display = "block";
            }
        });
    }

    renderStatusPopup(id: number, link: ISearchResultLink): void {
        const container: HTMLDivElement = document.createElement('div');
        container.style.display = "none";

        document.body.appendChild(container);

        this.renderNode(
            AnalyzerPageStatus,
            {
                id: `TLL_${id}`,
                url: link.url,
                threatStatus: link.response,
                linkScannerActive: true,
            },
            container,
        )
    }

    renderStatusTooltip(id: number, link: ISearchResultLink): HTMLElement {
        const container: HTMLElement = link.container;

        container.setAttribute("id", `BDTLL_${id}`);
        container.addEventListener('click', (event) => {
            // When clicking on the status bullet open new tab with bitdefender page.
            let encodedURL = link.url;
            try {
                encodedURL = encodeURIComponent(link.url);
            } catch (error) { }

            window.open(
                `${BDTLL.Consts.SEARCH_INFO_URL}${encodedURL}`,
                "_blank"
            );

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            return false;
        });

        this.renderNode(
            StatusTooltip,
            {
                url: BDTLL.Consts.SEARCH_INFO_URL + link.url,
                threatStatus: link.response
            },
            container,
        );

        return container;
    }

    renderNode(component: string | React.FunctionComponent | React.ComponentClass, attributes: INodeAttributes, container: HTMLElement): void {
        ReactDOM.render(
            React.createElement(component, attributes, null),
            container
        );
    }
}

const tf: Promise<boolean> = BDTLL.MessageService.messageBackground({
    command: BDTLL.Command.GET_SETTING,
    type: BDTLL.SettingType.THREAT_FILTER
}) as Promise<boolean>;

const whitelist: Promise<string[]> = BDTLL.MessageService.messageBackground({
    command: BDTLL.Command.GET_WHITELIST
}) as Promise<string[]>;

const sessionWhitelist: Promise<string[]> = BDTLL.MessageService.messageBackground({
    command: BDTLL.Command.GET_SESSION_WHITELIST,
}) as Promise<string[]>;

const SA = new SearchAnalyzer();
