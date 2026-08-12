/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";
import Browser = require("webextension-polyfill");

interface ICheckedDomain {
    verdict?: BDTLL.PageStatus;
    response?: Browser.WebRequest.BlockingResponseOrPromise;
    id?: number;
}

interface IChromeDownloadItem extends Browser.Downloads.DownloadItem {
    finalUrl: string
}

interface IChromeRequest extends Browser.WebRequest.OnBeforeRequestDetailsType {
    documentId: string;
}

export class InterceptRequests implements BDTLL.ISwitchable {
    checkedDomains: Record<string, ICheckedDomain> = {};
    session: BDTLL.ISession;
    injectAPHcount: number = 0;
    _shouldInjectAPH: boolean;
    fbMalvertisingListener: (tabId: number, changeInfo: Browser.Tabs.OnUpdatedChangeInfoType, tab: Browser.Tabs.Tab) => void;
    aphListener: (tabId: number, changeInfo: Browser.Tabs.OnUpdatedChangeInfoType, tab: Browser.Tabs.Tab) => void;
    searchAnalyzerListener: (tabId: number, changeInfo: Browser.Tabs.OnUpdatedChangeInfoType, tab: Browser.Tabs.Tab) => void;
    threatFilterListener: (requestDetails: Browser.WebRequest.OnBeforeRequestDetailsType) => Browser.WebRequest.BlockingResponseOrPromise;
    downloadListener: (downloadItem: IChromeDownloadItem) => Promise<void>;

    constructor(session: BDTLL.ISession) {
        this.session = session;

        if (BDTLL.Utils.getCurrentBrowser() == BDTLL.BrowserType.FIREFOX) {
            this.threatFilterListener = this.filterFirefox.bind(this);
        } else {
            this.threatFilterListener = this.filterChrome.bind(this);
            this.fbMalvertisingListener = this.injectFacebookMalvertising.bind(this);
        }

        this.aphListener = this.injectAntiphishing.bind(this);
        this.searchAnalyzerListener = this.injectSearchAnalyzer.bind(this);
        this.downloadListener = this.filterMV3Downloads.bind(this);

        if (!BDTLL.BrowserConsts.DISABLED_FEATURES.includes(BDTLL.Features.CHAT_PROTECTION)) {
            Browser.tabs.onUpdated.addListener(this.injectChatProtection.bind(this));
        }
    }

    get shouldInjectAPH(): boolean {
        return this._shouldInjectAPH;
    }

    set shouldInjectAPH(value: boolean) {
        let oldValue: boolean = this._shouldInjectAPH;

        this.injectAPHcount += value ? 1 : -1;

        this._shouldInjectAPH = (this.injectAPHcount > 0);

        if (oldValue != this._shouldInjectAPH)
            this._shouldInjectAPH ? this.startPageScanner() : this.stopPageScanner();
    }

    async filterChrome(requestDetails: IChromeRequest): Promise<Browser.WebRequest.BlockingResponseOrPromise> {
        if (requestDetails.url.startsWith(BDTLL.CLOUD_SERVER)) {
            return undefined;
        }

        const page: BDTLL.WebPage = await this.session.scanURL(requestDetails.url);
        const hostname: string = new URL(requestDetails.url).hostname;

        if (BDTLL.MaliciousStatuses.indexOf(page.threatStatus) === -1)
            return undefined;

        // present documentId means that the request is for a sub resource,
        // in the case of google search, it is a prefetch to the top search result sites
        // which could be malicious, triggering the blocked page before the user tries navigating to that site
        if (requestDetails.type === "main_frame" && !requestDetails.documentId) {
            this.checkedDomains = {};
            const isBlocked: boolean = await this.session.checkBlockedPage(requestDetails.tabId, page);

            if (isBlocked) {
                this.session.tabs[requestDetails.tabId] = page;
                this.checkedDomains[hostname] = {
                    verdict: page.threatStatus,
                    id: 0
                };
            }
        } else {
            if (this.checkedDomains[hostname] == null) {
                this.checkedDomains[hostname] = {
                    verdict: page.threatStatus,
                    id: Object.keys(this.checkedDomains).length
                };

                Browser.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: [this.checkedDomains[hostname].id],
                    addRules: [{
                        id: this.checkedDomains[hostname].id,
                        priority: 1,
                        action: { type: "block" },
                        condition: {
                            urlFilter: hostname,
                            resourceTypes: ["sub_frame", "xmlhttprequest", "other"]
                        }
                    }]
                });
            }

            this.session.sendBlockedPages([page]);
        }

        return undefined;
    }

    async filterFirefox(requestDetails: Browser.WebRequest.OnBeforeRequestDetailsType): Promise<Browser.WebRequest.BlockingResponseOrPromise> {
        if (requestDetails.url.startsWith(BDTLL.CLOUD_SERVER)) {
            return undefined;
        }

        let verdict: BDTLL.PageStatus;
        let response: Browser.WebRequest.BlockingResponseOrPromise;
        let domainExtracted: string;
        const url: URL = new URL(requestDetails.url);

        if (url.hostname.split("www.")[1] == null) {
            domainExtracted = url.hostname;
        } else {
            domainExtracted = url.hostname.split("www.")[1];
        }

        if (requestDetails.type != "main_frame" && domainExtracted in this.checkedDomains)
            return this.checkedDomains[domainExtracted].response;

        const page: BDTLL.WebPage = await this.session.scanURL(requestDetails.url);

        if (typeof page === 'undefined' || page === null) {
            return undefined;
        }

        verdict = page.threatStatus;

        if (page.sessionWhitelisted)
            return undefined;

        if (BDTLL.MaliciousStatuses.indexOf(verdict) > -1) {
            if (requestDetails.type == "main_frame") {
                this.checkedDomains = {};
                this.session.tabs[requestDetails.tabId] = page;

                const redirectURL: string = BDTLL.Utils.getExtensionUrl(
                    `pages/blocked/blocked.html?status=${verdict}&url=${encodeURIComponent(requestDetails.url)}`
                )

                response = {
                    redirectUrl: redirectURL
                };
            } else {
                response = {
                    cancel: true
                };
            }

            this.session.sendBlockedPages([page]);
        }

        this.checkedDomains[domainExtracted] = {
            verdict: verdict,
            response: response
        };

        return response;
    }

    async filterMV3Downloads(downloadItem: IChromeDownloadItem): Promise<void> {
        const page: BDTLL.WebPage = await this.session.scanURL(downloadItem.finalUrl);

        if (BDTLL.MaliciousStatuses.indexOf(page.threatStatus) > -1) {
            Browser.downloads.cancel(downloadItem.id);
            Browser.downloads.removeFile(downloadItem.id);
            Browser.downloads.erase({
                id: downloadItem.id
            });
        }
    }

    injectSearchAnalyzer(tabId: number, changeInfo: Browser.Tabs.OnUpdatedChangeInfoType, tab: Browser.Tabs.Tab): void {
        if (changeInfo.status !== "complete") {
            return;
        }

        if (tab == null || tab.url == null || !tab.url.startsWith("http")) {
            return;
        }

        if (BDTLL.DEBUG_MODE) {
            console.log("Injecting SA...");
        }

        if (BDTLL.Utils.getCurrentBrowser() == BDTLL.BrowserType.FIREFOX) {
            Browser.tabs.executeScript(tabId, {
                file: "/content/searchAnalyzer.js"
            });
        } else {
            Browser.scripting.executeScript({
                files: ["/content/searchAnalyzer.js"],
                target: {
                    tabId: tabId
                }
            }).then((injectionResult: Browser.Scripting.InjectionResult[]) => {
                if (BDTLL.DEBUG_MODE) {
                    console.log(`InjectionResult SA -> ${JSON.stringify(injectionResult)}`);
                }
            });
        }
    }

    injectAntiphishing(tabId: number, changeInfo: Browser.Tabs.OnUpdatedChangeInfoType, tab: Browser.Tabs.Tab): void {
        if (changeInfo.status !== "complete") {
            return;
        }

        if (tab == null || tab.url == null || !tab.url.startsWith("http")) {
            return;
        }

        if (BDTLL.DEBUG_MODE) {
            console.log("Injecting antiphishing...");
        }

        if (BDTLL.Utils.getCurrentBrowser() == BDTLL.BrowserType.FIREFOX) {
            Browser.tabs.executeScript(tabId, {
                file: "/content/antiphishing.js"
            })
        } else {
            Browser.scripting.executeScript({
                files: ["/content/antiphishing.js"],
                target: {
                    tabId: tabId
                }
            }).then((injectionResult: Browser.Scripting.InjectionResult[]) => {
                if (BDTLL.DEBUG_MODE) {
                    console.log(`InjectionResult APH -> ${JSON.stringify(injectionResult)}`);
                }
            }).catch(async (error: Error) => {
                if (error && error.message) {
                    if (error.message.includes("cannot be scripted")) {
                        // Known issues regarding some scripting policy
                        // In this case we want to fallback using just the url/status service
                        // to check if the URL is malicious or not.
                        const page: BDTLL.WebPage = await this.session.scanURL(tab.url);
                        this.session.tabs[tabId] = page;
                    }
                }
            });
        }
    }

    injectFacebookMalvertising(tabId: number, changeInfo: Browser.Tabs.OnUpdatedChangeInfoType, tab: Browser.Tabs.Tab): void {
        if (tab.url?.includes("www.facebook.com") && changeInfo.status === "complete") {
            Browser.scripting.executeScript({
                files: ["src/content/content.js"],
                target: {
                    tabId: tabId
                }
            })
        }
    }

    injectChatProtection(tabId: number, changeInfo: Browser.Tabs.OnUpdatedChangeInfoType, tab: Browser.Tabs.Tab): void {
        if (changeInfo.status !== "complete" || BDTLL.Utils.currentChatPlatform(tab.url) === null)
            return;

        if (BDTLL.Utils.getCurrentBrowser() == "firefox") {
            Browser.tabs.executeScript(tabId, {
                file: "/content/chatAnalyzer.js"
            }).catch(error => {
                console.error("Failed to inject chat protection:", error);
            });
        } else {
            Browser.scripting.executeScript({
                files: ["/content/chatAnalyzer.js"],
                target: {
                    tabId: tabId
                }
            }).catch(error => {
                console.error("Failed to inject chat protection:", error);
            });
        }
    }

    startThreatFilter(): void {
        if (BDTLL.Utils.getCurrentBrowser() == BDTLL.BrowserType.FIREFOX) {
            Browser.webRequest.onBeforeRequest.addListener(
                this.threatFilterListener,
                { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame", "xmlhttprequest", "other"] },
                ['blocking']
            );
        } else {
            Browser.downloads.onCreated.addListener(this.downloadListener);
            Browser.webRequest.onBeforeRequest.addListener(
                this.threatFilterListener,
                { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame", "xmlhttprequest", "other"] }
            );

            if (!Browser.tabs.onUpdated.hasListener(this.fbMalvertisingListener)) {
                Browser.tabs.onUpdated.addListener(this.fbMalvertisingListener);
            }
        }
    }

    stopThreatFilter(): void {
        Browser.webRequest.onBeforeRequest.removeListener(this.threatFilterListener);

        if (BDTLL.Utils.getCurrentBrowser() != BDTLL.BrowserType.FIREFOX) {
            Browser.downloads.onCreated.removeListener(this.downloadListener);

            if (Browser.tabs.onUpdated.hasListener(this.fbMalvertisingListener)) {
                Browser.tabs.onUpdated.removeListener(this.fbMalvertisingListener);
            }
        }
    }

    startPageScanner(): void {
        Browser.tabs.onUpdated.addListener(this.aphListener);
    }

    stopPageScanner(): void {
        Browser.tabs.onUpdated.removeListener(this.aphListener);
    }

    startSearchAnalyzer(): void {
        Browser.tabs.onUpdated.addListener(this.searchAnalyzerListener);
    }

    stopSearchAnalyzer(): void {
        Browser.tabs.onUpdated.removeListener(this.searchAnalyzerListener);
    }

    enable(setting: BDTLL.SettingType): void {
        switch (setting) {
            case BDTLL.SettingType.THREAT_FILTER:
                this.startThreatFilter();
                this.shouldInjectAPH = true;
                break;
            case BDTLL.SettingType.SEARCH_ANALYZER:
                this.startSearchAnalyzer();
                break;
        }
    }

    disable(setting: BDTLL.SettingType): void {
        switch (setting) {
            case BDTLL.SettingType.THREAT_FILTER:
                this.stopThreatFilter();
                this.shouldInjectAPH = false;
                break;
            case BDTLL.SettingType.SEARCH_ANALYZER:
                this.stopSearchAnalyzer();
                break;
        }
    }
}
