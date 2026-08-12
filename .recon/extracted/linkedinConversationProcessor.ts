import { ConversationProcessor } from "./conversationProcessor";
import { IChatAnalyzer } from "../BDTLL_ChatProtection";
import {
    IFrameSelector, ShadowDomSelector, ConversationOverlaySelectors,
    IgnoreOverlaySelectors, OverlaysRootSelector
} from "../dataExtractors/linkedinDataExtractor";

export class LinkedInConversationProcessor extends ConversationProcessor {
    private static tooltipStylesCache: string;
    private static stylesInjectedInShadowDom = false;

    private static iframeElem: HTMLElement;
    private static shadowElem: ShadowRoot;
    private static messagingTabElem: HTMLElement;

    private static shadowDomObserver: MutationObserver;
    private static iframeObserver: MutationObserver;

    private pageTitle: string;
    private observerConfig: MutationObserverInit = {
        subtree: true,
        childList: true
    };

    constructor(userWhitelist: string[], sessionWhitelist: string[], chatAnalyzer: IChatAnalyzer) {
        super(userWhitelist, sessionWhitelist, chatAnalyzer);
    }

    private async loadTooltipStyles(): Promise<void> {
        if (LinkedInConversationProcessor.tooltipStylesCache) {
            return;
        }

        try {
            const cssUrl: string = chrome.runtime.getURL('pages/components/tooltip.css');
            const response: Response = await fetch(cssUrl);
            LinkedInConversationProcessor.tooltipStylesCache = await response.text();
        } catch (error) {
            LinkedInConversationProcessor.tooltipStylesCache = '.BDTLL_status { cursor: pointer; display: inline; margin-right: 3px; width: 16px; height: 16px; }';
        }
    }

    async observerSetup(element: HTMLElement): Promise<void> {
        await this.loadTooltipStyles();

        const overlaysObserver: MutationObserver = new MutationObserver(this.sandboxObserverCallback.bind(this));
        const messagingTabObserver = new MutationObserver(async (mutations: MutationRecord[]) => {
            const title: HTMLTitleElement = document.head.querySelector("title");

            if (title?.innerText === this.pageTitle) {
                return;
            }

            if (
                (LinkedInConversationProcessor.iframeElem && !LinkedInConversationProcessor.iframeElem?.isConnected) ||
                (LinkedInConversationProcessor.shadowElem && !LinkedInConversationProcessor.shadowElem?.isConnected)
            ) {
                this.resetSandboxObservers();
            }
            this.pageTitle = title.innerText;

            await this.bodyObserverCallback(mutations);
        });

        messagingTabObserver.observe(document.head, {
            ...this.observerConfig,
            characterData: true
        });
        overlaysObserver.observe(document.documentElement, this.observerConfig);
    }

    resetSandboxObservers(): void {
        LinkedInConversationProcessor.iframeObserver?.disconnect();
        LinkedInConversationProcessor.iframeObserver = null;

        LinkedInConversationProcessor.shadowDomObserver?.disconnect();
        LinkedInConversationProcessor.shadowDomObserver = null;

        LinkedInConversationProcessor.stylesInjectedInShadowDom = false;
        LinkedInConversationProcessor.iframeElem = null;
        LinkedInConversationProcessor.shadowElem = null;
    }

    async bodyObserverCallback(mutations: MutationRecord[]): Promise<void> {
        let conversationSource: HTMLElement = document.body.querySelector(IgnoreOverlaySelectors.join());
        let iframe: HTMLIFrameElement = document.documentElement.querySelector(IFrameSelector);
        const iframeConversation: HTMLElement = iframe?.contentDocument.documentElement.querySelector(IgnoreOverlaySelectors.join());

        if (iframeConversation) {
            conversationSource = iframeConversation;
        }

        if (!conversationSource) {
            return;
        }

        if (
            LinkedInConversationProcessor.messagingTabElem &&
            !LinkedInConversationProcessor.messagingTabElem.isConnected
        ) {
            if (this.elementObservers.has(LinkedInConversationProcessor.messagingTabElem)) {
                this.elementObservers.get(LinkedInConversationProcessor.messagingTabElem).disconnect();
                this.elementObservers.delete(LinkedInConversationProcessor.messagingTabElem);
                LinkedInConversationProcessor.messagingTabElem = null;
            }
        }

        if (document.location.href.includes("/messaging/")) {
            if (!this.elementObservers.has(conversationSource)) {
                await super.singleObserverSetup(conversationSource);
                LinkedInConversationProcessor.messagingTabElem = conversationSource;
            }
        }
    }

    async sandboxObserverCallback(mutations: MutationRecord[]): Promise<void> {
        const shadowDom: ShadowRoot = document.documentElement.querySelector(ShadowDomSelector)?.shadowRoot;
        this.insertStyleSheets(shadowDom);
        if (shadowDom && !LinkedInConversationProcessor.shadowDomObserver) {
            LinkedInConversationProcessor.shadowDomObserver = new MutationObserver(
                async (mutations: MutationRecord[]) => {
                    await this.handleConversationOverlaysChange(mutations, shadowDom);
                }
            );
            LinkedInConversationProcessor.shadowElem = shadowDom;
            LinkedInConversationProcessor.shadowDomObserver.observe(shadowDom, this.observerConfig);
        }

        const iframe: HTMLIFrameElement = document.documentElement.querySelector(IFrameSelector);
        this.insertStyleSheets(iframe);
        if (iframe && !LinkedInConversationProcessor.iframeObserver) {
            const overlaysRoot: HTMLElement = iframe.contentDocument.querySelector(OverlaysRootSelector);
            if (overlaysRoot) {
                LinkedInConversationProcessor.iframeObserver = new MutationObserver(
                    async (mutations: MutationRecord[]) => {
                        await this.handleConversationOverlaysChange(mutations, overlaysRoot);
                    }
                );
                LinkedInConversationProcessor.iframeElem = overlaysRoot;
                LinkedInConversationProcessor.iframeObserver.observe(overlaysRoot, this.observerConfig);

                if (overlaysRoot.querySelector(ConversationOverlaySelectors.join())) {
                    await this.handleConversationOverlaysChange(null, overlaysRoot);
                }
            }
        }

        if (document.documentElement.querySelector(ConversationOverlaySelectors.join())) {
            await this.handleConversationOverlaysChange(mutations, document.documentElement);
        }

        if (iframe?.contentDocument.documentElement.querySelector(IgnoreOverlaySelectors.join())) {
            await this.bodyObserverCallback(mutations);
        }
    }

    async handleConversationOverlaysChange(mutations: MutationRecord[] | null, context: HTMLElement | ShadowRoot): Promise<void> {
        if (mutations) {
            for (const mutation of mutations) {
                if (mutation.type !== "childList") {
                    continue;
                }

                mutation.removedNodes.forEach((chatBubble: HTMLElement) => {
                    if (this.elementObservers.has(chatBubble)) {
                        this.elementObservers.get(chatBubble).disconnect();
                        this.elementObservers.delete(chatBubble);
                    }
                });
            }
        }

        const overlays: NodeListOf<HTMLElement> = context.querySelectorAll(ConversationOverlaySelectors.join());
        for (const overlay of Array.from(overlays)) {
            if (this.elementObservers.has(overlay)) {
                continue;
            }

            await super.singleObserverSetup(overlay);
        }
    }

    insertStyleSheets(sandbox: ShadowRoot | HTMLIFrameElement): void {
        if (sandbox instanceof ShadowRoot && !LinkedInConversationProcessor.stylesInjectedInShadowDom) {
            try {
                const sheet: CSSStyleSheet = new CSSStyleSheet();
                sheet.replaceSync(LinkedInConversationProcessor.tooltipStylesCache);
                sandbox.adoptedStyleSheets.push(sheet);
                LinkedInConversationProcessor.stylesInjectedInShadowDom = true;
            } catch (error) {
                if (!sandbox.querySelector('#bdtll-tooltip-styles')) {
                    const style: HTMLStyleElement = document.createElement('style');
                    style.id = 'bdtll-tooltip-styles';
                    style.textContent = LinkedInConversationProcessor.tooltipStylesCache;
                    sandbox.appendChild(style);
                    LinkedInConversationProcessor.stylesInjectedInShadowDom = true;
                }
            }
        } else if (sandbox instanceof HTMLIFrameElement) {
            const doc: Document = sandbox?.contentDocument;
            if (!doc.querySelector('#bdtll-tooltip-styles')) {
                const style: HTMLStyleElement = doc.createElement('style');
                style.id = 'bdtll-tooltip-styles';
                style.textContent = LinkedInConversationProcessor.tooltipStylesCache;

                try {
                    const head: HTMLHeadElement = doc.documentElement.querySelector('head');
                    head.appendChild(style);
                } catch (error) {
                    const body: HTMLElement = doc.documentElement.querySelector('body') || doc.documentElement;
                    body.appendChild(style);
                }
            }
        }
    }

    processAnchor(hook: HTMLElement): HTMLElement {
        const existingTooltip: HTMLElement = hook.querySelector(
            "div.BDTLL_Tooltip_Container > span.BDTLL_Span"
        );

        if (existingTooltip) {
            return existingTooltip;
        }

        hook.style.display = "flex";
        const messageContainer: HTMLDivElement = document.createElement('div');
        Array.from(hook.children).forEach((node: HTMLElement) => {
            messageContainer.appendChild(node);
        });

        messageContainer.style.marginLeft = "-11%";
        messageContainer.style.width = "95%";
        messageContainer.classList.add("BDTLL_MessageContainer");
        hook.appendChild(messageContainer);

        const tooltipContainer: HTMLDivElement = document.createElement('div');
        const span: HTMLSpanElement = document.createElement("span");

        span.classList.add("BDTLL_Span");
        tooltipContainer.classList.add("BDTLL_Tooltip_Container");
        tooltipContainer.style.marginLeft = "12%";
        tooltipContainer.style.marginTop = "2%";
        tooltipContainer.style.zIndex = "1";

        tooltipContainer.appendChild(span);
        hook.insertBefore(tooltipContainer, messageContainer);

        return span;
    }
}