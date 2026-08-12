/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";
import Browser = require("webextension-polyfill");

export interface IMessage {
    command: BDTLL.Command,
    type?: BDTLL.SettingType,
    value?: string,
    request?: IRequestInfo,
    urls?: string[],
    message?: boolean,
    enabled?: boolean,
    smsConversation?: BDTLL.IStoredConversationStatus
    userAgent?: string
}

export interface IRequestInfo {
    url: string,
    body: string,
    title: string,
    meta: string,
    domain: string,
    scripts: string[]
}

export interface INativeMessage {
    request: BDTLL.NativeAppMessageRequestType,
    browser?: string,
    permissionsStatus?: BDTLL.PermissionsStatus,
    pagesBlocked?: BDTLL.WebPage[],
    scannedPages?: number,
    conversation?: BDTLL.IStoredConversationStatus,
}

export interface INativeResponse {
    request?: string,
    serviceStatus?: number,
    malvertisingSupportEnabled?: boolean,
    smsMessagesStatus?: BDTLL.IScannedMessage[],
    chatProtectionSettings?: IChatProtectionSettings,
}

export interface IUrlStatusResponse {
    url: string,
    status_code: number,
    status_message: string[],
    domain_grey: boolean,
    ignore: boolean,
    ttl: number
}

export interface IChatProtectionSettings {
    ChatProtectionState: boolean,
    MessagesState: boolean,
    WhatsappState: boolean,
    TelegramState: boolean,
    FacebookState: boolean,
    DiscordState: boolean,
    LinkedInState: boolean,
    ScanContacts: boolean,
    ScanPastMessages: boolean,
    ScanPastMessagesTimestamp: number
}

interface INativeServiceResult {
    enabled?: boolean,
    sms_result?: ILambadaSMSResponse[],
    chat_protection_settings?: IChatProtectionSettings
}

interface IRawNativeResponse {
    request: string,
    service_status: number,
    service_result: INativeServiceResult
}

interface ISMSClusteringResponse {
    status_code: number,
    status_message: string[],
    cluster_id: string
}

export interface ILambadaSMSResponse {
    status_code: number,
    status_message: string[],
    ttl: number,
    sms_c: ISMSClusteringResponse,
    sndt: boolean,
    sndnr: boolean,
    _id: string,
    url_status: IUrlStatusResponse[]
}

type ServiceResponse = void | boolean | string[] | BDTLL.WebPage | BDTLL.PageStatus[] |
                        BDTLL.StorageData | BDTLL.IScannedMessage[] | BDTLL.IChatProtectionSettings;

export class MessageService {
    /**
     * @description the message has a different return type depending on the command, see BDTLL.Command for what each command type returns
     */
    public static async messageBackground(message: IMessage): Promise<ServiceResponse> {
        return Browser.runtime.sendMessage(message);
    }

    public static async messageForeground(tabId: number, message: IMessage): Promise<ServiceResponse> {
        return Browser.tabs.sendMessage(tabId, message).catch((error: Error) => {
            // known error
            if (error.message == "The message port closed before a response was received.") {
                return;
            }

            throw error;
        });
    }

    /**
     * @description should be called only from background scripts, content scripts will not have access to Browser.runtime.sendNativeMessage
     */
    /*
    Example of a native message response:
    {
        "request": "scanMessages",
        "service_status": 0,
        "service_result": {
            "sms_result": [
                {
                    "status_code": 1, // general verdict 0 = clean, any other value = malicious
                    "status_message": [ // Status messages for url present in scan
                        "malware",
                        "phishing"
                    ],
                    "ttl": 1800, // cache time to live in seconds
                    "sms_c": { // SMS Clustering response for whole scan
                        "status_code": 1, // 0 = clean, any other value = malicious
                        "status_message": [
                            "untrusted"
                        ],
                        "cluster_id": "09e33sb70ntw"
                    },
                    "sndt": true, // true if should submit message text to cloud, see /lambada/osx/scam_alert/text endpoint
                    "sndnr": true, // true if should submit phone number of message sender to cloud, see /osx/scam_alert/nr endp
                    "_id": "AAABkKZel4UAAAAAIO9r" // match id for text/number submissions
                    "url_status": [
                    {
                        "url": "www.whaturlwasscaned.com", // url that has info in this object
                        "status_code": 1, // general verdict 0 = clean, any other value = malicious
                        "status_message": [ // Status messages for url present in scan
                            "malware",
                            "phishing"
                        ],
                        "domain_grey": true, // grey domains should not be cached
                        "ignore": false, // whether the domain is clean and should be ignored/whitelisted
                        "ttl": 1800 // cache time to live in seconds
                    },
                    ...
                    ]
                }
            ]
        }
    }
    */
    public static async sendNativeMessage(message: BDTLL.INativeMessage): Promise<INativeResponse> {
        if (BDTLL.DEBUG_MODE) {
            console.log("Sending native message: ", message);
        }

        const rawResponse: IRawNativeResponse = await Browser.runtime.sendNativeMessage(BDTLL.NATIVE_COMMUNICATION_APP_NAME, message);
        let response: INativeResponse = {};

        if (BDTLL.DEBUG_MODE) {
            console.log("Received native response: ", rawResponse);
        }

        if (message.request === BDTLL.NativeAppMessageRequestType.SCAN_MESSAGES) {
            response.smsMessagesStatus = [];

            for (let i = 0; i < message.conversation.messages.length; i++) {
                const element: BDTLL.IScannedMessage = message.conversation.messages[i];
                const rawScanResult: IUrlStatusResponse = BDTLL.Utils.getTopThreatFromScanSMSResponseArray(
                    rawResponse.service_result.sms_result[i]?.url_status
                );

                if (rawScanResult === null) {
                    response.smsMessagesStatus.push({
                        sender: element.sender,
                        text: element.text,
                        url: "invalid-url",
                        status: null
                    });

                    continue;
                }

                const url: string = rawScanResult.url;
                const statusCode: number = rawScanResult.status_code;
                const status: BDTLL.PageStatus = rawScanResult.status_message[0] as BDTLL.PageStatus;

                let smsResponse: BDTLL.IScannedMessage = {
                    sender: element.sender,
                    text: element.text,
                    url: url,
                    status: statusCode === 0 ? BDTLL.PageStatus.SAFE : status
                }

                response.smsMessagesStatus.push(smsResponse);
            }

            return response;
        }

        response.request = rawResponse.request;
        response.serviceStatus = rawResponse.service_status;
        response.malvertisingSupportEnabled = rawResponse.service_result?.enabled || false;
        response.chatProtectionSettings = rawResponse.service_result?.chat_protection_settings;

        return response;
    }

    public static addListener(callback: (message: BDTLL.IMessage, sender?: Browser.Runtime.MessageSender) => Promise<ServiceResponse> | void): void {
        Browser.runtime.onMessage.addListener(callback);
    }

    public static removeListener(listener: (message: BDTLL.IMessage, sender?: Browser.Runtime.MessageSender) => Promise<ServiceResponse> | void): void {
        Browser.runtime.onMessage.removeListener(listener);
    }

    public static hasListener(listener: (message: BDTLL.IMessage, sender?: Browser.Runtime.MessageSender) => Promise<ServiceResponse> | void): void {
        Browser.runtime.onMessage.hasListener(listener);
    }
}