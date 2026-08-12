/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";
import Browser = require("webextension-polyfill");

export interface ISession {
    tabs: Record<string, WebPage>;
    scanURL(url: string): Promise<WebPage>;
    scanThreat(request: BDTLL.IRequestInfo, tabId: string): Promise<WebPage>;
    checkBlockedPage(tabId: number, page: WebPage): Promise<boolean>;
    sendBlockedPages(pages: [WebPage]): void;
}

export class WebPage {
    url: string;
    threatStatus: BDTLL.PageStatus;
    scanned = false;
    sessionWhitelisted = false;
    trackerList: Array<string>;
    timestamp: number;

    constructor(url: string, threatStatus: BDTLL.PageStatus = null) {
        this.url = url;
        this.threatStatus = threatStatus;
        this.timestamp = Date.now();
    }
}

export class Session implements ISession, BDTLL.ISwitchable {
    public static lastMalvertisingStatus: boolean;

    appWhitelist: BDTLL.IWhitelist;
    scanner: BDTLL.IScanner;
    defaultPageStatus: BDTLL.PageStatus;
    currentBrowser: BDTLL.BrowserType;

    whitelistHandler = {
        set: (obj: Record<string, WebPage>, url: string, newPage: WebPage) => {
            obj[url] = newPage;
            obj[url].sessionWhitelisted = true;
            obj[url].threatStatus = BDTLL.PageStatus.SESSION_WHITELISTED;

            BDTLL.Storage.set(BDTLL.StorageKeys.SESSION_WHITELIST, obj).then(() => {
                // Then nothing, the value was susccesfully set
            }).catch((error: Error) => {
                if (BDTLL.DEBUG_MODE) {
                    console.error(`Cannot set ${BDTLL.StorageKeys.SESSION_WHITELIST}: ${error}`);
                }
            });

            return true;
        },
        get: (obj: Record<string, WebPage>, url: string) => {
            let page: WebPage = obj[url];

            if (page == null) {
                page = new WebPage(url);
            }

            return page;
        },
        has: (obj: Record<string, WebPage>, urlToTest: string) => {
            const domain = BDTLL.Utils.extractRootDomain(urlToTest);

            for (const url in obj) {
                if (domain == BDTLL.Utils.extractRootDomain(url)) {
                    return true;
                }
            }

            return false;
        }
    };

    whitelist = new Proxy<Record<string, WebPage>>({}, this.whitelistHandler);

    tabs = new Proxy<Record<string, WebPage>>({}, {
        set: (obj: Record<string, WebPage>, tabId: string, newPage: WebPage) => {
            obj[tabId] = newPage;

            this.setBrowserAction(tabId, newPage);

            return true;
        }
    });

    processPage: { [key: string]: { processor: (request: BDTLL.IRequestInfo) => WebPage, active: boolean } } = {
        [BDTLL.SettingType.THREAT_FILTER]: {
            processor: this.scanThreat.bind(this),
            active: false
        },
        [BDTLL.SettingType.SEARCH_ANALYZER]: {
            processor: null,
            active: false
        },
    };

    constructor(appWhitelist: BDTLL.IWhitelist, scanner: BDTLL.IScanner) {
        this.appWhitelist = appWhitelist;
        this.scanner = scanner;
        this.defaultPageStatus = (
            this.processPage[BDTLL.SettingType.THREAT_FILTER].active
                ? BDTLL.PageStatus.SAFE : BDTLL.PageStatus.DISABLED
        );
        this.currentBrowser = BDTLL.Utils.getCurrentBrowser();

        // This should be null initially, and updated only when the communication with the service is successful
        BDTLL.Session.lastMalvertisingStatus = null;

        if (this.currentBrowser != BDTLL.BrowserType.FIREFOX) {
            BDTLL.Storage.get(BDTLL.StorageKeys.LAST_MALVERTISING_STATUS).then((malvertisingStatus: boolean) => {
                console.log(`Read last malvertising status from the storage: ${malvertisingStatus}`);

                if (typeof (malvertisingStatus) !== "undefined") {
                    BDTLL.Session.lastMalvertisingStatus = malvertisingStatus;
                }
            }).catch((error: Error) => {
                if (BDTLL.DEBUG_MODE) {
                    console.warn(`Cannot get ${BDTLL.StorageKeys.LAST_MALVERTISING_STATUS}: ${error}`);
                }
            });

            BDTLL.Storage.get(BDTLL.StorageKeys.SESSION_WHITELIST).then((sessionWhitelist: Record<string, WebPage>) => {
                if (typeof (sessionWhitelist) !== "undefined") {
                    this.whitelist = new Proxy<Record<string, WebPage>>(sessionWhitelist, this.whitelistHandler);
                } else {
                    this.whitelist = new Proxy<Record<string, WebPage>>({}, this.whitelistHandler);
                }
            }).catch((error: Error) => {
                this.whitelist = new Proxy<Record<string, WebPage>>({}, this.whitelistHandler);

                if (BDTLL.DEBUG_MODE) {
                    console.error(`Cannot get ${BDTLL.StorageKeys.SESSION_WHITELIST}: ${error}`);
                }
            });

            Browser.alarms.get("tll-sp-timer").then((alarm: Browser.Alarms.Alarm) => {
                if (alarm === undefined) {
                    Browser.alarms.create(
                        "tll-sp-timer",
                        {
                            delayInMinutes: BDTLL.REPORT_SCANNED_PAGES_TIME_INTERVAL,
                            periodInMinutes: BDTLL.REPORT_SCANNED_PAGES_TIME_INTERVAL,
                        }
                    );
                } else {
                    if (BDTLL.DEBUG_MODE) {
                        console.log("tll-update-timer already registered!");
                    }
                }
            });
        }

        this.listen();
    }

    public static async checkMalvertisingSupport(): Promise<boolean> {
        if (BDTLL.DEBUG_MODE) {
            console.log("Check malvertising support");
        }

        const message: BDTLL.INativeMessage = {
            request: BDTLL.NativeAppMessageRequestType.MALVERTISING_SUPPORT,
        };

        let enabled: boolean = BDTLL.Session.lastMalvertisingStatus != null ?
            BDTLL.Session.lastMalvertisingStatus : BDTLL.MALVERTISING_ENABLED_DEFAULT_VALUE;

        try {
            const response: BDTLL.INativeResponse = await BDTLL.MessageService.sendNativeMessage(message);

            if (BDTLL.DEBUG_MODE) {
                console.log(`Malvertising support response: ${JSON.stringify(response, null, 4)}`);
            }

            if (response?.serviceStatus === 0) {
                enabled = response.malvertisingSupportEnabled;

                Browser.storage.local.set({
                    [BDTLL.StorageKeys.LAST_MALVERTISING_STATUS]: enabled
                }).then(() => {
                    BDTLL.Session.lastMalvertisingStatus = enabled;
                }).catch((error: Error) => {
                    if (BDTLL.DEBUG_MODE) {
                        console.warn(`Cannot set ${BDTLL.StorageKeys.LAST_MALVERTISING_STATUS}: ${error}`);
                    }
                });
            }

            return enabled;
        } catch (error) {
            if (BDTLL.DEBUG_MODE) {
                console.warn(`Session: Failed to check malvertising support: ${error}! Consider malvertising enabled = ${enabled}!`);
            }

            return enabled;
        }
    }

    async sessionWhitelist(tabId: number): Promise<boolean> {
        // At this point, the URL of the object in tabs[tabId] = our blocked page
        let page: WebPage = this.tabs[tabId];

        if (page != null) {
            const parsedURL: URL = new URL(
                decodeURIComponent(page.url)
            );

            page.url = parsedURL.searchParams.get("url");
        } else {
            const url: string = await BDTLL.Utils.getURLForTabId(+tabId);
            page = new WebPage(url, BDTLL.PageStatus.SESSION_WHITELISTED);
        }

        this.tabs[tabId] = page;
        this.whitelist[page.url] = page;

        // Redirect the page
        await Browser.tabs.update(+tabId, {
            url: page.url,
        });

        return true;
    }

    async getSessionWhitelist(): Promise<string[]> {
        const urlsInSessionWhitelist: string[] = Object.keys(this.whitelist);
        const domainsInSessionWhitelist: string[] = urlsInSessionWhitelist.map((url: string) => {
            return BDTLL.Utils.extractRootDomain(url);
        });

        return domainsInSessionWhitelist;
    }

    async handlePageScan(request: BDTLL.IRequestInfo, tabId: number): Promise<WebPage> {
        let page: WebPage = new WebPage(request.url);

        try {
            for (const setting in this.processPage) {
                if (this.processPage[setting].active) {
                    page = this.processPage[setting].processor(request);
                }
            }

            this.tabs[tabId] = page;

            if (request.url in this.whitelist) {
                return page;
            }
        } catch (error) { }

        return page;
    }

    async scanURL(url: string): Promise<WebPage> {
        let page: WebPage = new WebPage(url);

        try {
            if (this.appWhitelist.isWhitelisted(url)) {
                page.threatStatus = BDTLL.PageStatus.WHITELISTED
                return page;
            }

            if (url in this.whitelist) {
                this.whitelist[url] = page;
            }

            if (page.threatStatus == null) {
                page.threatStatus = await this.scanner.scanLink(url);
            }
        } catch (error) { }

        return page;
    }

    async scanThreat(request: BDTLL.IRequestInfo): Promise<WebPage> {
        let page: WebPage = new WebPage(request.url);

        try {
            if (this.appWhitelist.isWhitelisted(request.url)) {
                page.threatStatus = BDTLL.PageStatus.WHITELISTED;
                return page;
            }

            if (request.url in this.whitelist) {
                this.whitelist[request.url] = page;
            }

            if (!page.scanned) {
                const verdict: BDTLL.PageStatus = await this.scanner.scanPage(request);
                page.threatStatus = (verdict == BDTLL.PageStatus.PHISHING) ? verdict : page.threatStatus;
                page.scanned = true;
            }

            if (page.threatStatus == null) {
                page = await this.scanURL(page.url);
            }
        } catch (error) { }

        return page;
    }

    async getPageInfo(): Promise<WebPage> {
        try {
            const currentTab: Browser.Tabs.Tab = await BDTLL.Utils.getCurrentTab();
            const tabId: number = currentTab.id;
            let page: WebPage = new WebPage(currentTab.url);

            if (!(tabId in this.tabs)) {
                // In case the service worker becomes inactive, tabs object will be empty
                // thus, tabId will not be found. And in case the user clicks on the
                // action button, in order to get the information to be displayed on the
                // popup, we need to scan the URL first.

                var urlToScan = currentTab.url;
                if (urlToScan.startsWith(BDTLL.Utils.getExtensionUrl("pages/blocked/blocked.html")))
                {
                    const urlParams = new URLSearchParams(urlToScan);
                    urlToScan = urlParams.get('url');
                }

                page = await this.scanURL(urlToScan);
                this.tabs[tabId] = page;
            } else if (this.tabs[tabId] != null) {
                page = this.tabs[tabId];
            }

            if (page.threatStatus == null) {
                page.threatStatus = await this.scanner.scanLink(currentTab.url);
            }

            if (!this.processPage[BDTLL.SettingType.THREAT_FILTER].active) {
                page.threatStatus = BDTLL.PageStatus.DISABLED;
            }

            if (page.sessionWhitelisted) {
                page.threatStatus = BDTLL.PageStatus.SESSION_WHITELISTED;
            }

            this.tabs[tabId] = page;

            return page;
        } catch (error) { }
    }

    async checkBlockedPage(tabId: number, page: WebPage): Promise<boolean> {
        if (!this.processPage[BDTLL.SettingType.THREAT_FILTER].active) {
            return false;
        }

        if (!BDTLL.Utils.isMaliciousPage(page)) {
            return false;
        }

        try {
            const redirectURL: string = `/pages/blocked/blocked.html?status=${page.threatStatus}&url=${encodeURIComponent(page.url)}`;
            await Browser.tabs.update(tabId, {
                url: redirectURL
            });

            this.sendBlockedPages([page]);
            return true;
        } catch (error) {
            // Might happen with an invalid tabID.
            return false;
        }
    }

    setBrowserAction(tabId: string, page: WebPage): void {
        if (tabId == null || page == null) {
            return;
        }

        try {
            let threatStatus: BDTLL.PageStatus = this.defaultPageStatus;

            if (!this.processPage[BDTLL.SettingType.THREAT_FILTER].active) {
                threatStatus = BDTLL.PageStatus.DISABLED;
            } else if (BDTLL.Utils.isURLSearchEngine(page.url) && !this.processPage[BDTLL.SettingType.SEARCH_ANALYZER].active) {
                threatStatus = BDTLL.PageStatus.SEARCH_ANALYZER_DISABLED;
            } else {
                threatStatus = page.threatStatus;
            }

            // setIcon is not supported for android devices
            // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/BrowserAction
            if (!navigator.userAgent.match(/Android/i)) {
                if (this.currentBrowser == BDTLL.BrowserType.FIREFOX) {
                    Browser.browserAction.setIcon({
                        path: BDTLL.toBarIcon[threatStatus],
                        tabId: +tabId
                    });
                } else {
                    Browser.action.setIcon({
                        path: BDTLL.toBarIcon[threatStatus],
                        tabId: +tabId
                    });
                }
            }
        } catch (error) { }
    }

    sendBlockedPages(pages: [WebPage]): void {
        const blockedPages: BDTLL.WebPage[] = Array.from(pages);

        if (BDTLL.DEBUG_MODE) {
            console.log(`Blocked pages: ${JSON.stringify(blockedPages, null, 4)}`);
        }

        if (blockedPages.length > 0) {
            const message: BDTLL.INativeMessage = {
                request: BDTLL.NativeAppMessageRequestType.BLOCKED_PAGES,
                browser: this.currentBrowser,
                pagesBlocked: blockedPages
            };

            BDTLL.MessageService.sendNativeMessage(message).then((response: BDTLL.INativeResponse) => {
                if (BDTLL.DEBUG_MODE) {
                    console.log("Blocked pages sent succesfully!");
                    console.log(response.serviceStatus);
                }
            }).catch((error: Error) => {
                if (BDTLL.DEBUG_MODE) {
                    console.error(error);
                }
            });
        }
    }

    sendScannedPages(): void {
        const scannedPages: number = this.scanner.getNumberOfScannedPages();

        if (scannedPages > 0) {
            if (BDTLL.DEBUG_MODE) {
                console.log(`Sending scanned pages: ${scannedPages}`);
            }
            const message: BDTLL.INativeMessage = {
                request: BDTLL.NativeAppMessageRequestType.SCANNED_PAGES,
                browser: this.currentBrowser,
                scannedPages: scannedPages
            }
            BDTLL.MessageService.sendNativeMessage(message).then((response: BDTLL.INativeResponse) => {
                if (BDTLL.DEBUG_MODE) {
                    console.log("Scanned pages sent succesfully!");
                    console.log(response.serviceStatus);
                }

                this.scanner.resetScannedPagesCounter();
            }).catch((error: Error) => {
                // Refresh counter even if there was an error when sending the message.
                // In case the host is not installed on the user"s computer
                // the counter will not be sent succesfully and thus the counter
                // will increase continously.
                this.scanner.resetScannedPagesCounter();
                if (BDTLL.DEBUG_MODE) {
                    console.error(`Failed to send the scanned pages: ${error}!`);
                }
            });
        }
    }

    enable(setting: BDTLL.SettingType): void {
        switch (setting) {
            case BDTLL.SettingType.THREAT_FILTER:
                this.processPage[setting].active = true;
                this.defaultPageStatus = BDTLL.PageStatus.SAFE;
                break;
            case BDTLL.SettingType.SEARCH_ANALYZER:
                this.processPage[BDTLL.SettingType.SEARCH_ANALYZER].active = true;
                this.defaultPageStatus = BDTLL.PageStatus.SAFE;
                break;
        }
    }

    disable(setting: BDTLL.SettingType): void {
        switch (setting) {
            case BDTLL.SettingType.THREAT_FILTER:
                this.processPage[setting].active = false;
                this.defaultPageStatus = BDTLL.PageStatus.DISABLED;
                break;
            case BDTLL.SettingType.SEARCH_ANALYZER:
                this.processPage[BDTLL.SettingType.SEARCH_ANALYZER].active = false;
                this.defaultPageStatus = BDTLL.PageStatus.SEARCH_ANALYZER_DISABLED;
                break;
        }
    }

    async getScannedMessages(conversation: BDTLL.IStoredConversationStatus): Promise<BDTLL.IStoredConversationStatus> {
        return await BDTLL.Storage.get(`${conversation.platform}/${BDTLL.StorageKeys.SCANNED_MESSAGES}/${conversation.conversationName}`) as BDTLL.IStoredConversationStatus;
    }

    async setScannedMessages(conversation: BDTLL.IStoredConversationStatus): Promise<void> {
        return await BDTLL.Storage.set(`${conversation.platform}/${BDTLL.StorageKeys.SCANNED_MESSAGES}/${conversation.conversationName}`, {
            messages: conversation.messages
        });
    }

    listen(): void {
        if (this.currentBrowser == BDTLL.BrowserType.FIREFOX) {
            setInterval(() => {
                this.sendScannedPages();
            }, BDTLL.REPORT_SCANNED_PAGES_TIME_INTERVAL * 60 * 1000);

            Browser.tabs.onCreated.addListener(() => {
                Browser.browserAction.setIcon({
                    path: BDTLL.toBarIcon[this.defaultPageStatus],
                });
            });
        }

        Browser.tabs.onUpdated.addListener(
            async (tabId: number, changeInfo: Browser.Tabs.OnUpdatedChangeInfoType, tab: Browser.Tabs.Tab) => {
                if (changeInfo.status === "complete") {
                    if (tab !== undefined && "url" in tab) {
                        const currentURL: string = tab.url;
                        const currentEncodedURL: string = encodeURIComponent(currentURL);
                        const pageStatus: BDTLL.PageStatus = new URLSearchParams(new URL(currentURL).search).get("status") as BDTLL.PageStatus;

                        if (currentURL === "chrome://newtab/" || currentURL === "about:home" || currentURL === "about:blank") {
                            this.tabs[tabId] = new WebPage(currentEncodedURL, this.defaultPageStatus);
                        } else if (BDTLL.MaliciousStatuses.indexOf(pageStatus) > -1) {
                            this.tabs[tabId] = new WebPage(currentEncodedURL, pageStatus);
                        } else if (currentURL.indexOf("/pages/settings/settings.html") > 0) {
                            this.tabs[tabId] = new WebPage(currentEncodedURL, BDTLL.PageStatus.SAFE);
                        } else {
                            const page: BDTLL.WebPage = await this.scanURL(currentURL);
                            this.tabs[tabId] = page;
                        }
                    }
                }
            }
        );

        Browser.tabs.onRemoved.addListener(
            (tabId: number) => {
                delete this.tabs[tabId];
            }
        );

        BDTLL.MessageService.addListener(
            (message: BDTLL.IMessage, sender: Browser.Runtime.MessageSender) => {
                switch (message.command) {
                    case BDTLL.Command.SCAN_PAGE:
                        return this.handlePageScan(message.request, sender.tab.id);
                    case BDTLL.Command.GET_PAGE_INFO:
                        return this.getPageInfo();
                    case BDTLL.Command.SESSION_WHITELIST:
                        return this.sessionWhitelist(sender.tab.id);
                    case BDTLL.Command.GET_SESSION_WHITELIST:
                        return this.getSessionWhitelist();
                    case BDTLL.Command.CHECK_MALVERTISING_ENABLED:
                        return Session.checkMalvertisingSupport();
                    case BDTLL.Command.GET_MESSAGES:
                        return this.getScannedMessages(message.smsConversation);
                    case BDTLL.Command.SET_MESSAGES:
                        console.log(message.value);
                        return this.setScannedMessages(message.smsConversation);
                }
            }
        );

        if (this.currentBrowser != BDTLL.BrowserType.FIREFOX) {
            Browser.alarms.onAlarm.addListener((alarm: Browser.Alarms.Alarm) => {
                if (alarm.name === "tll-sp-timer") {
                    this.sendScannedPages();
                }
            });

            Browser.runtime.onStartup.addListener(() => {
                // `onStartup` event is triggered when a new session is created
                BDTLL.Storage.remove(BDTLL.StorageKeys.SESSION_WHITELIST).then(() => {
                    this.whitelist = new Proxy<Record<string, WebPage>>({}, this.whitelistHandler);
                }).catch(() => {
                    this.whitelist = new Proxy<Record<string, WebPage>>({}, this.whitelistHandler);
                });
            });
        }
    }
}