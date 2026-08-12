import { DEBUG_MODE } from "../../BDTLLCommon";
import { GenericSearchEngine } from "./searchEngine";

const UrlSelectors: string[] = [
    "div.sb_tlst a",
    "div.sn_hd a",
    "div.sb_add :is(h1,h2,h3,h4,h5,h6) a",
    "div.sa_uc a",
    "div.scs_child_rpr table a",
    "div#ans_news a",
    "li.b_algo :is(h2,h3) a",
    "li.b_top :is(h2,h3) a",
    // Copilot Search
    "div.answer_container :is(h1,h2,h3,h4,h5,h6) a",
    "div.answer_container div.b_acf_card a",
    "div.answer_container a.urlinstlink",
    "div.answer_container div[class*='landWrapper'] a",
    "div.answer_container div.b_wam a",
    "div.developer_answercard_wrapper div.rd_gencon_tta a",
    "div#devmag_card_content_dynamic div.rd_attr_items a",
    "div.answer_container div.gs_cit a",
    "div.answer_container div[class*='genserp_citation_hover'] a",
    "div.answer_container div.gs_caphead_main a:not(:has(img))",
    'div.answer_container div.b_gwaTitle a'
]

export class Bing extends GenericSearchEngine {
    constructor() {
        super();
        this.UrlSelectors = UrlSelectors.join();
    }

    processAnchor(element: HTMLElement): HTMLElement {
        if (element.matches("[class*='acf_card_link']")) {
            return element.nextElementSibling?.firstElementChild as HTMLElement || element;
        }

        return element;
    }

    protected getElementUrl(element: HTMLElement, checkDuplicates: boolean): string {
        let url: string = super.getElementUrl(element, checkDuplicates);

        if (!url) {
            return undefined;
        }

        try {
            const urlObj: URL = new URL(url);

            // regular search results redirect
            if (urlObj.pathname.includes('/ck/a')) {
                const encodedUrl: string = urlObj.searchParams.get('u');

                if (encodedUrl) {
                    // Remove the 2-char prefix (e.g., "a1")
                    let base64Url: string = encodedUrl.substring(2);

                    // Convert from URL-safe Base64 to standard Base64
                    base64Url = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                    while (base64Url.length % 4) {
                        base64Url += '=';
                    }

                    const decodedUrl: string = atob(base64Url);

                    if (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://')) {
                        return decodedUrl;
                    }
                }
            }

            // ad click redirects
            if (urlObj.pathname.includes('/aclick')) {
                const encodedUrl: string = urlObj.searchParams.get('u');

                if (encodedUrl) {
                    // Decode Base64 (no prefix for aclick URLs)
                    const decodedUrl: string = atob(encodedUrl);
                    const finalUrl: string = decodeURIComponent(decodedUrl);

                    if (finalUrl.startsWith('http://') || finalUrl.startsWith('https://')) {
                        return finalUrl;
                    }
                }
            }
        } catch (e) {
            if (DEBUG_MODE) {
                console.error('Failed to process Bing URL:', url, e);
            }
        }

        return url;
    }

    insertAndStyleTooltipContainer(anchor: HTMLElement, container: HTMLElement): void {
        super.insertAndStyleTooltipContainer(anchor, container);

        let parent: HTMLElement = anchor.parentElement;
        const cardHolder: HTMLDivElement = document.createElement("div");
        cardHolder.classList.add("BDTLL_Container");

        if (anchor.closest("[class*='acf_t_c_inner']")) {
            container.style.marginLeft = "-2.5%";
            container.style.marginRight = "-1%";
            container.style.marginTop = "1%";

            parent.classList.forEach(cls => cardHolder.classList.add(cls));
        } else if (anchor.matches("a.urlinstlink")) {
            parent = anchor.firstElementChild.firstElementChild as HTMLElement;

            container.style.marginRight = "1.5%";
            container.style.marginTop = "1%";

            parent.style.marginLeft = "-1.5%";
        } else if (
            anchor.parentElement.matches("[class*='landWrapper']") ||
            anchor.parentElement.matches(".b_wam") ||
            anchor.parentElement.matches(".rd_gencon_tta")
        ) {
            parent = anchor;

            container.style.marginLeft = "-2.5%";
            container.style.marginRight = "1%";
            container.style.marginTop = "1%";
        } else if (anchor.closest("h1,h2,h3,h4,h5,h6")?.matches(".b_topTitle")) {
            anchor.closest("h1,h2,h3,h4,h5,h6").parentElement.style.paddingRight = "4%";
        } else if (anchor.parentElement.matches(".rd_attr_items")) {
            parent = anchor;

            container.style.marginLeft = "2.5%";
            container.style.marginTop = "2%";
            
            cardHolder.style.display = "flex";
            cardHolder.style.flexDirection = "row";
        } else if (anchor.closest(".gs_cits,[class*='genserp_citation_hover']")) {
            parent = anchor.firstElementChild as HTMLElement;

            if (anchor.matches(".hov-item")) {
                parent = anchor;
                cardHolder.style.maxWidth = "90%";
            }

            parent.style.display = "flex";
            parent.style.flexDirection = "row";

            container.style.marginTop = "1%";
            container.style.marginRight = "1%";
        } else if (anchor.closest('.gs_caphead_main')) {
            parent = anchor;

            container.style.float = "none";
        }

        parent.insertBefore(container, parent.firstElementChild);

        if (anchor.querySelector(".BDTLL_Container") || anchor.closest(".BDTLL_Container")) {
            return;
        }

        Array.from(parent.children).forEach(child => {
            if (child === container) {
                return;
            }

            cardHolder.appendChild(child);
        });

        parent.style.display = "flex";
        parent.style.flexDirection = "row";

        parent.appendChild(cardHolder);
    }

    async handleUrlChange(element: HTMLElement): Promise<void> {
        const url: string = this.getElementUrl(element, true);

        if (!url || url.endsWith("...")) {
            return;
        }

        await super.handleUrlChange(element);
    }
}