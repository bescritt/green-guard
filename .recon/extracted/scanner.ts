/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import Browser = require("webextension-polyfill");
import * as BDTLL from "../BDTLL";

export interface IScanner {
    internalWhitelist: Array<string>;
    getNumberOfScannedPages(): number;
    resetScannedPagesCounter(): void;
    scanLink(url: string): Promise<BDTLL.PageStatus>,
    scanPage(request: BDTLL.IRequestInfo): Promise<BDTLL.PageStatus>,
}

export class Scanner implements IScanner {
    internalWhitelist: Array<string>;
    scannedPagesCounter: number;
    assl: BDTLL.IAssl;

    constructor(assl: BDTLL.IAssl) {
        BDTLL.Storage.get(BDTLL.StorageKeys.INTERNAL_WHITELIST).then((response: string) => {
            response = response || "";
            this.internalWhitelist = response.split("");
        }).catch((error: Error) => {
            this.internalWhitelist = [];

            if (BDTLL.DEBUG_MODE) {
                console.error(`Cannot get ${BDTLL.StorageKeys.INTERNAL_WHITELIST}: ${error}`);
            }
        });

        BDTLL.Storage.get(BDTLL.StorageKeys.TLL_SP).then((counter: number) => {
            this.scannedPagesCounter = counter || 0;
        }).catch((error: Error) => {
            this.scannedPagesCounter = 0;

            if (BDTLL.DEBUG_MODE) {
                console.error(`Cannot get ${BDTLL.StorageKeys.TLL_SP}: ${error}`);
            }
        });

        this.assl = assl;
        this.listen();
    }

    async scanLink(url: string): Promise<BDTLL.PageStatus> {
        if (this.internalWhitelist?.indexOf(url) > -1) {
            return BDTLL.PageStatus.SAFE;
        }

        const status: BDTLL.PageStatus | BDTLL.PageStatus[] = await BDTLL.CloudTalk.interogateCloud(url);
        this.scannedPagesCounter += 1;
        BDTLL.Storage.set(BDTLL.StorageKeys.TLL_SP, this.scannedPagesCounter);

        return (status as BDTLL.PageStatus);
    }

    async scanLinks(urls: string[]): Promise<BDTLL.PageStatus[]> {
        const statuses: BDTLL.PageStatus[] = await BDTLL.CloudTalk.interogateCloud(urls) as BDTLL.PageStatus[];
        this.scannedPagesCounter += urls.length;
        BDTLL.Storage.set(BDTLL.StorageKeys.TLL_SP, this.scannedPagesCounter);

        return statuses;
    }

    async scanMessages(conversation: BDTLL.IStoredConversationStatus): Promise<BDTLL.IScannedMessage[]> {
        const avQuery: BDTLL.INativeResponse = await BDTLL.MessageService.sendNativeMessage({
            request: BDTLL.NativeAppMessageRequestType.SCAN_MESSAGES,
            conversation: conversation
        });

        return avQuery.smsMessagesStatus;
    }

    async scanPage(request: BDTLL.IRequestInfo): Promise<BDTLL.PageStatus> {
        let verdict: BDTLL.PageStatus = BDTLL.PageStatus.SAFE;

        if (this.internalWhitelist?.indexOf(request.url) > -1) {
            return verdict;
        }

        const decodedBody: string = BDTLL.Utils.removeHTMLTags(request.body);
        const resp: BDTLL.IRule = this.assl.scan(
            this.assl.sign,
            this.assl.nosign,
            request.meta,
            request.body,
            decodedBody,
            request.url,
            request.title,
            request.domain,
            request.scripts
        );

        if (resp.action == "PHISHING") {
            verdict = BDTLL.PageStatus.PHISHING;
            let lastUpdateDate: string = new Date().toLocaleDateString();
            try {
                lastUpdateDate = await BDTLL.Storage.get(BDTLL.StorageKeys.DATE) as string;
            } catch (error) { }

            // TODO: Might be useful to use the current browser
            // instead of chrome all the time

            // const currentBrowser = BDTLL.Utils.getCurrentBrowser();
            // const prodVersion = `${BDTLL.Consts.VERSION}_${currentBrowser}_${lastUpdateDate}`;
            const prodVersion: string = `${BDTLL.Consts.VERSION}_chrome_${lastUpdateDate}`;
            BDTLL.Utils.reportCatch(request.url, "TLL", prodVersion, resp.name);
        }

        return verdict;
    }

    async getChatProtectionSettings(): Promise<BDTLL.IChatProtectionSettings> {
        const response: BDTLL.INativeResponse = await BDTLL.MessageService.sendNativeMessage({
            request: BDTLL.NativeAppMessageRequestType.CHAT_PROTECTION_SETTINGS
        });
        return response.chatProtectionSettings;
    }

    getNumberOfScannedPages(): number {
        return this.scannedPagesCounter;
    }

    resetScannedPagesCounter(): void {
        BDTLL.Storage.set(BDTLL.StorageKeys.TLL_SP, 0).then(() => {
            if (BDTLL.DEBUG_MODE) {
                console.log("Counter was reset!");
            }
            this.scannedPagesCounter = 0;
        }).catch((error: Error) => {
            if (BDTLL.DEBUG_MODE) {
                console.error(error);
            }
        });
    }

    listen() {
        BDTLL.MessageService.addListener(
            (message: BDTLL.IMessage) => {
                switch(message.command) {
                    case BDTLL.Command.SCAN_LINKS:
                        return this.scanLinks(message.urls);
                    case BDTLL.Command.SCAN_MESSAGES:
                        return this.scanMessages(message.smsConversation);
                    case BDTLL.Command.GET_CHAT_PROTECTION_SETTINGS:
                        return this.getChatProtectionSettings();
                }
            }
        )
    }
}