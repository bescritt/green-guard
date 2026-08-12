/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */
import { ICloudResponse, IUrlStatusResponse } from "../BDTLL";
import * as BDTLL from "../BDTLLCommon"
import { WebPage } from "../background/session";
import * as secondDomainsJSON from "./secondDomains.json"
import Browser = require("webextension-polyfill");

export enum BrowserType {
    CHROME = "chrome",
    FIREFOX = "firefox",
    OPERA = "opera",
    EDGE = "ms edge",
    EDGE_CHROMIUM = "ms edge (chromium based)",
    IE = "ms ie",
    UNKNOWN = "unknown"
}

export class Utils {
    static checkUserAgreement(
        userAgreementStatus: BDTLL.UserAgreementPermissionsStatus | undefined,
        strictCheck: boolean = false,
    ): boolean {
        if (userAgreementStatus == undefined) {
            return false;
        }

        if (strictCheck) {
            // For strict check, we should return true only if the user completely
            // granted all permissions for the extension
            return !!(userAgreementStatus & BDTLL.UserAgreementPermissionsStatus.GRANTED);
        } else {
            // If not strict check, we return true if the user did not deny
            // the permissions
            return !(userAgreementStatus & BDTLL.UserAgreementPermissionsStatus.DENIED);
        }
    }

    static permissionStatusFromLoadingLocation(
        loadingLocation: BDTLL.UserAgreementPermissionsLoadingLocation
    ): BDTLL.UserAgreementPermissionsStatus {
        if (loadingLocation === BDTLL.UserAgreementPermissionsLoadingLocation.BROWSER_TAB) {
            return BDTLL.UserAgreementPermissionsStatus.GRANTED_FROM_BROWSER_TAB;
        } else if (loadingLocation === BDTLL.UserAgreementPermissionsLoadingLocation.BROWSER_EXTENSION_POPUP) {
            return BDTLL.UserAgreementPermissionsStatus.GRANTED_FROM_BROWSER_EXTENSION_POPUP;
        } else {
            return BDTLL.UserAgreementPermissionsStatus.GRANTED;
        }
    }

    static removeHTMLTags(strInput: string): string {
        strInput = strInput.replace(/&(lt|gt);/g, (p1: string) => {
            return (p1 == "lt") ? "<" : ">";
        });

        const strTagStrippedText: string = strInput.replace(/<\/?[^>]+(>|$)/g, "");
        return strTagStrippedText;
    }

    static trim(stringToTrim: string): string {
        return stringToTrim.replace(/^\s+|\s+$/g, "");
    }

    static ltrim(stringToTrim: string): string {
        return stringToTrim.replace(/^\s+/, "");
    }

    static rtrim(stringToTrim: string): string {
        return stringToTrim.replace(/\s+$/, "");
    }

    static async getCurrentWindowTabs(): Promise<Browser.Tabs.Tab[]> {
        try {
            return await Browser.tabs.query({
                windowType: "normal",
            });
        } catch (error) {
            console.warn(`Could not get all windows tabs with error: ${error}`);
            return [];
        }
    }

    static async reloadTab(tab: Browser.Tabs.Tab): Promise<void> {
        await Browser.tabs.reload(tab.id, { bypassCache: true });
    };

    static async reloadAllTabs(): Promise<void> {
        const tabs: Browser.Tabs.Tab[] = await BDTLL.Utils.getCurrentWindowTabs();

        await Promise.allSettled(
            tabs.map(
                tab => BDTLL.Utils.reloadTab(tab)
            )
        );
    };

    static async closeTabWithUrlContaining(urlSubstring: string): Promise<boolean> {
        const tabs: Browser.Tabs.Tab[] = await BDTLL.Utils.getCurrentWindowTabs();

        for (const tab of tabs) {
            if (tab.url.includes(urlSubstring)) {
                try {
                    await Browser.tabs.remove(tab.id);
                    return true;
                } catch (error) {
                    console.warn(`Could not remove tab with error: ${error}`);
                    return false;
                }
            }
        }

        return false;
    }

    static constructWhitelist(): string[] {
        let white: string[];

        if (typeof (localStorage['internalWhitelist']) != 'undefined' && localStorage['internalWhitelist']) {
            white = localStorage['internalWhitelist'].split('\n');
        }

        return white;
    }

    static xHTTPRequest() {
        const xhr: XMLHttpRequest = new XMLHttpRequest();

        const promiseXhr = {
            nativeXhr: xhr,
            send: (data: string = null) => {
                return new Promise<XMLHttpRequest | void>((resolve, reject) => {
                    promiseXhr.nativeXhr.onload = () => {
                        if (promiseXhr.nativeXhr.status === 200) {
                            resolve(promiseXhr.nativeXhr);
                        } else {
                            reject(Error('XMLHttpRequest failed; error code:' + promiseXhr.nativeXhr.statusText));
                        }
                    },
                    promiseXhr.nativeXhr.onerror = reject;
                    promiseXhr.nativeXhr.send(data);
                });
            }
        };

        return promiseXhr;
    }

    static promiseTimeout(ms: number, promise: Promise<any>): Promise<any | void> {
        // Create a promise that rejects in ms milliseconds
        const timeout: Promise<void> = new Promise((resolve, reject) => {
            const id: NodeJS.Timeout = setTimeout(() => {
                clearTimeout(id);
                reject('Timed out in ' + ms + 'ms.')
            }, ms);
        });

        // Return the fastest between promise(the actual job we have to do) and the timeout created earlier
        return Promise.race([
            promise,
            timeout
        ]);
    }

    static getCurrentBrowser(): BrowserType {
        try {
            const userAgent: string = navigator.userAgent.toLowerCase();

            if (userAgent.indexOf("firefox") > -1) {
                return BrowserType.FIREFOX;
            } else if (userAgent.indexOf("chrome") > -1) {
                return BrowserType.CHROME;
            } else if (userAgent.indexOf("opr") > -1) {
                return BrowserType.OPERA;
            } else if (userAgent.indexOf("trident") > -1) {
                return BrowserType.IE;
            } else if (userAgent.indexOf("edge") > -1) {
                return BrowserType.EDGE;
            } else if (userAgent.indexOf("edg/") > -1) {
                return BrowserType.EDGE_CHROMIUM;
            } else {
                return BrowserType.UNKNOWN;
            }
        } catch (error) {
            return BrowserType.UNKNOWN;
        }
    }

    // Determine if the URL is a search result and should have the links scanned
    static getDomainForLinkScan(hostURL: string): BDTLL.SearchEngine {
        try {
            const url: URL = new URL(hostURL);

            if (url.hostname.indexOf(BDTLL.SearchEngine.SEARCH_GOOGLE) >= 0) {
                return BDTLL.SearchEngine.SEARCH_GOOGLE;
            }
            if (url.hostname.indexOf(BDTLL.SearchEngine.SEARCH_YAHOO_JP) >= 0) {
                return BDTLL.SearchEngine.SEARCH_YAHOO_JP;
            }
            if (url.hostname.indexOf(BDTLL.SearchEngine.SEARCH_YAHOO) >= 0) {
                return BDTLL.SearchEngine.SEARCH_YAHOO;
            }
            if (url.hostname.indexOf(BDTLL.SearchEngine.SEARCH_BING) >= 0) {
                return BDTLL.SearchEngine.SEARCH_BING;
            }
            if (url.hostname.indexOf(BDTLL.SearchEngine.SEARCH_DUCKDUCKGO) >= 0) {
                return BDTLL.SearchEngine.SEARCH_DUCKDUCKGO;
            }
        } catch (exception) {
            return null;
        }

        return null;
    }

    static currentChatPlatform(hostURL: string) : BDTLL.ChatPlatform {
        try {
            const url: URL = new URL(hostURL);

            if (url.hostname.indexOf(BDTLL.ChatPlatform.WHATSAPP) >= 0) {
                return BDTLL.ChatPlatform.WHATSAPP;
            } else if (url.hostname.indexOf(BDTLL.ChatPlatform.FB_MESSENGER) >= 0 ||
                    (url.hostname.indexOf(BDTLL.ChatPlatform.FACEBOOK) >= 0 && url.pathname.indexOf("/messages/") >= 0)) {
                return BDTLL.ChatPlatform.FB_MESSENGER;
            } else if (url.hostname.indexOf(BDTLL.ChatPlatform.FACEBOOK) >= 0) {
                return BDTLL.ChatPlatform.FACEBOOK;
            } else if (url.hostname.indexOf(BDTLL.ChatPlatform.TELEGRAM) >= 0) {
                return BDTLL.ChatPlatform.TELEGRAM;
            } else if (url.hostname.indexOf(BDTLL.ChatPlatform.DISCORD) >= 0) {
                return BDTLL.ChatPlatform.DISCORD;
            } else if (url.hostname.indexOf(BDTLL.ChatPlatform.LINKEDIN) >= 0) {
                return BDTLL.ChatPlatform.LINKEDIN;
            }
        } catch (exception) {
            return null;
        }
        
        return null;
    }

    static getLocalizedText(key: string): string {
        return Browser.i18n.getMessage(key);
    }

    static getLanguage(): string {
        return Browser.i18n.getUILanguage()
    }

    static reportCatch(url: string, prodInfo: string, prodVers: string, sign: string) {
        const reportCatchURL: string =
            `https://nimbus.bitdefender.net/report/aphish?JSVersion=J1` +
            `&LID=${encodeURIComponent("N/A")}` +
            `&PhDatsVersion=7&ProdInfo=${encodeURIComponent(prodInfo)}` +
            `&ProdVers=${encodeURIComponent(prodVers)}` +
            `&PhASSLHitRules=${encodeURIComponent(sign)}` +
            `&Type=catch&Url=${encodeURIComponent(url)}`;

        fetch(
            reportCatchURL,
            {
                method: 'GET',
                headers: {
                    'X-Nimbus-ClientId': BDTLL.BrowserConsts.BROWSER_CLIENTID || '',
                }
            }
        ).then((response: Response) => {
            return response.json();
        }).then((body: ICloudResponse) => {
                if (BDTLL.DEBUG_MODE) {
                    console.log(`Report catch status_code = ${body.status_code}`);
                }
            }
        ).catch(
            (error: Error) => {
                if (BDTLL.DEBUG_MODE) {
                    console.error(error);
                }
            }
        );
    }

    static reportAnon(ads: string): void {
        // TODO: OEM change; unused ?!
        const anonRepUrl: string = "https://nimbus.bitdefender.net/report/aphish";
        const oRequest = this.xHTTPRequest();
        const requestParams = {
            'ProdInfo': 'TLL',
            'ProdVers': BDTLL.Consts.VERSION,
            'Type': 'fb_ads_full',
            'adds': ads
        }
        const requestParamsJSON: string = JSON.stringify(requestParams);

        oRequest.nativeXhr.open("POST", anonRepUrl, true);
        oRequest.nativeXhr.setRequestHeader('Content-Type', 'application/json');
        if (BDTLL.BrowserConsts) {
            oRequest.nativeXhr.setRequestHeader("X-Nimbus-ClientId", BDTLL.BrowserConsts.BROWSER_CLIENTID || "");
        }
        oRequest.send(requestParamsJSON);
    }

    static isMaliciousPage(page: WebPage): boolean {
        if (page == null) {
            return false;
        }

        if (page.threatStatus == null) {
            return false;
        }

        return (
            !page.sessionWhitelisted &&
            BDTLL.MaliciousStatuses.indexOf(page.threatStatus) > -1
        );
    }

    static evaluateExpression(expression: string): boolean {
        let start: number, end: number;
        let innerExpression: string;

        while (expression.indexOf('(') >= 0) {
            end = expression.indexOf(')');
            start = expression.substr(0, end).lastIndexOf('(');

            if (start > end) {
                return false;
            }

            innerExpression = expression.substr(start + 1, end - start - 1);
            expression = expression.substr(0, start) + this.evaluateExpression(innerExpression) + expression.substr(end + 1);
        }

        const terms = expression.split(" ");
        for (let i = 0; i < terms.length; i++) {
            if (terms[i].length == 0) {
                terms.splice(i, 1);
                i--;
            }
        }

        for (let i = 0; i < terms.length; i++) {
            if (terms[i] == "&&") {
                if (terms[i - 1] == "false" || terms[i + 1] == "false") {
                    terms[i - 1] = "false";
                } else {
                    terms[i - 1] = "true";
                }
                terms.splice(i, 2);
                i--;
            } else if (terms[i] == "==") {
                if (terms[i - 1] == terms[i + 1]) {
                    terms[i - 1] = "true";
                } else {
                    terms[i - 1] = "false";
                }
                terms.splice(i, 2);
                i--;
            }
        }

        for (let i = 0; i < terms.length; i++) {
            if (terms[i] == "true") {
                return true;
            }
        }

        return false;
    }

    static trimURLQuery(url: string): string {
        return url.split('?')[0];
    }

    static extractHostname(url: string): string {
        let hostname: string;
        //find & remove protocol (http, ftp, etc.) and get hostname

        if (url.indexOf("://") > -1) {
            hostname = url.split('/')[2];
        }
        else {
            hostname = url.split('/')[0];
        }

        //find & remove port number
        hostname = hostname.split(':')[0];
        //find & remove "?"
        hostname = hostname.split('?')[0];

        return hostname;
    }

    static extractRootDomain(url: string): string {
        let domain: string = this.extractHostname(url);
        const splitArr: string[] = domain.split('.');
        const arrLen: number = splitArr.length;

        if (arrLen > 2) {
            if (this.isIpAddress(domain)) {
                return domain;
            }

            domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];

            if (this.isSecondDomain(domain)) {
                domain = splitArr[arrLen - 3] + '.' + domain;
            }
        }

        return domain;
    }

/**
 * @param strictMatch whether the whole string should match the format or any substring
 */
    static isIpAddress(url: string, strictMatch: boolean = true): boolean {
        let matchString: string = '(((\\d{1,3}\\.){3}\\d{1,3})|'+ // IPv4
                                '([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4}))';// IPv6

        if (strictMatch) {
            matchString = '^' + matchString + '$';
        }

        const pattern: RegExp = new RegExp(matchString); 
        return pattern.test(url);
    }

/**
 * @param strictMatch whether the whole string should match the format or any substring
 */
    static validURL(str: string, strictMatch: boolean = true): boolean {
        let matchString: string = 
            '(https?:\\/\\/)?' + // protocol
            '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
            '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
            '(\\:\\d+)?(\/[-a-z\\d%_.~+()!$&\'*,;=:@]*)*' + // port and path
            '(\\?[;&a-z\\d%_.~+=!:@$\'()*,-]*)?' + // query string
            '(\\#.*)?'; // fragment locater

        if (strictMatch) {
            matchString = '^' + matchString + '$';
        }
        
        const pattern: RegExp = new RegExp(matchString, 'i');
        return pattern.test(str);
    }

    static isPhoneNumber(number: string): boolean {
        const pattern: RegExp = new RegExp('^(?:\\+\\d{1,3}|0\\d{1,3}|00\\d{1,2})?(?:\\s?\\(\\d+\\))?(?:[-\\/\\s.]|\\d)+$');
        return pattern.test(number);
    }

    static isURLSearchEngine(url: string): boolean {
        const hostname: string = this.extractHostname(url);

        let result: boolean = false;
        result = result || hostname.includes(BDTLL.SearchEngine.SEARCH_GOOGLE);
        result = result || hostname.includes(BDTLL.SearchEngine.SEARCH_YAHOO);
        result = result || hostname.includes(BDTLL.SearchEngine.SEARCH_YAHOO_JP);
        result = result || hostname.includes(BDTLL.SearchEngine.SEARCH_BING);
        result = result || hostname.includes(BDTLL.SearchEngine.SEARCH_DUCKDUCKGO);

        return result;
    }

    static anotherProtectionDetected(document: Document): boolean {
        const windowsWpId: string = "bd_nd_B937DB990D1548698380D65CF906E308";
        const byId: HTMLElement = document.getElementById(windowsWpId);
        const byClass: HTMLCollectionOf<Element> = document.getElementsByClassName(windowsWpId);

        return (byId != null || byClass?.length > 0);
    }

    static feedbackEnabled(): boolean {
        return (BDTLL.Consts.FEEDBACK_URL?.length > 0);
    }

    static async getCurrentTab(): Promise<Browser.Tabs.Tab> {
        const queryOptions = {
            active: true,
            currentWindow: true
        };
        const tabs: Browser.Tabs.Tab[] = await Browser.tabs.query(queryOptions);

        return tabs[0];
    }

    static async getCurrentTabId(): Promise<number> {
        const queryOptions = {
            active: true,
            currentWindow: true
        };

        const tabs: Browser.Tabs.Tab[] = await Browser.tabs.query(queryOptions);
        return tabs[0].id;
    }

    static async getCurrentTabUrl(): Promise<string> {
        const queryOptions = {
            active: true,
            currentWindow: true
        };
        
        const tabs: Browser.Tabs.Tab[] = await Browser.tabs.query(queryOptions);
        return tabs[0].url;
    }

    static async getURLForTabId(tabId: number): Promise<string> {
        const tab: Browser.Tabs.Tab = await Browser.tabs.get(tabId);
        return tab.url || null;
    }

    static getExtensionUrl(path: string): string {
        return Browser.runtime.getURL(path);
    }

    static async getSettingsTab(): Promise<Browser.Tabs.Tab> {
        const tabs: Browser.Tabs.Tab[] = await Browser.tabs.query({
            url: this.getExtensionUrl("pages/settings/settings.html")
        });
        return tabs.length > 0 ? tabs[0] : null;
    }

    static isSecondDomain(domain: string): boolean {
        const secondDomains: string[] = secondDomainsJSON["second_domains"];
        return secondDomains.indexOf(domain) > -1;
    }

    static extractURLFromChatRedirect(domain: BDTLL.ChatPlatform, hostURL: string): string {
        try {
            const url: URL = new URL(hostURL);

            if (domain === BDTLL.ChatPlatform.FB_MESSENGER || domain === BDTLL.ChatPlatform.FACEBOOK) {
                return url.searchParams.get("u") || hostURL;
            }
        } catch (exception) {
            return hostURL;
        }

        return hostURL;
    }

    static getTopThreatFromScanSMSResponseArray(
        responseArray: IUrlStatusResponse[]
    ): IUrlStatusResponse {
        if (responseArray === null || responseArray.length === 0) {
            return null;
        }

        let topThreat: IUrlStatusResponse = responseArray[0];
        let threatIndex: number = -1;

        for (const response of responseArray) {
            response.status_message.forEach(element => {
                const currentThreatIndex: number = BDTLL.StatusPriority.indexOf(element as BDTLL.PageStatus);

                if (currentThreatIndex > threatIndex) {
                    threatIndex = currentThreatIndex;
                    topThreat = response;
                }
            });
        }

        return topThreat;
    }
}
