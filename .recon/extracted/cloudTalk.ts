/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";

export interface ICloudResponse {
    categories: string[],
    domain_grey: boolean,
    status_code: number,
    status_message: string | string[]
}

export class CloudTalk {
    static cloudCache: Record<string, BDTLL.PageStatus> = {};
    static cacheTimeout: number = 5 * 60 * 1000; // 5 minutes

    static async extractVerdict(item: ICloudResponse): Promise<{
        status: BDTLL.PageStatus,
        domainGrey: boolean
    }> {
        let index: number = BDTLL.StatusPriority.indexOf(BDTLL.PageStatus.SAFE);
        let isMalvertisingEnabled: boolean = BDTLL.Session.lastMalvertisingStatus != null ? BDTLL.Session.lastMalvertisingStatus : BDTLL.MALVERTISING_ENABLED_DEFAULT_VALUE;

        if (item.status_message instanceof Array) {
            let malvertisingStatusChecked: boolean = false;
            let statusPriorityOrder: number[] = await Promise.all(item.status_message.map(async (status: string) => {
                if (status === BDTLL.PageStatus.MALVERTISING) {
                    if (!malvertisingStatusChecked) {
                        try {
                            isMalvertisingEnabled = await BDTLL.Session.checkMalvertisingSupport();
                            malvertisingStatusChecked = true;
                        } catch (error) {
                            if (BDTLL.DEBUG_MODE) {
                                console.warn(`CloudTalk: Error checking malvertising status: ${error}`);
                            }
                            malvertisingStatusChecked = false;
                        }
                    }

                    if (isMalvertisingEnabled) {
                        return BDTLL.StatusPriority.indexOf(BDTLL.PageStatus.MALVERTISING);
                    } else {
                        return BDTLL.StatusPriority.indexOf(BDTLL.PageStatus.SAFE);
                    }
                }

                return BDTLL.StatusPriority.indexOf(status as BDTLL.PageStatus);
            }));

            index = Math.max(index, ...statusPriorityOrder);
        } else {
            if (item.status_message === BDTLL.PageStatus.MALVERTISING) {
                try {
                    isMalvertisingEnabled = await BDTLL.Session.checkMalvertisingSupport();
                } catch (error) {
                    if (BDTLL.DEBUG_MODE) {
                        console.warn(`CloudTalk: Error checking malvertising status: ${error}`);
                    }
                }

                if (isMalvertisingEnabled) {
                    index = Math.max(BDTLL.StatusPriority.indexOf(BDTLL.PageStatus.MALVERTISING), index);
                } else {
                    // Replace status with SAFE if not enabled
                    index = Math.max(BDTLL.StatusPriority.indexOf(BDTLL.PageStatus.SAFE), index);
                }
            } else {
                index = Math.max(BDTLL.StatusPriority.indexOf(item.status_message as BDTLL.PageStatus), index);
            }
        }

        return {
            status: BDTLL.StatusPriority[index] as BDTLL.PageStatus,
            domainGrey: item.domain_grey
        };
    }

    static async interogateCloud(url: string | string[]): Promise<BDTLL.PageStatus | BDTLL.PageStatus[]> {
        let requestData: { [key: string]: string } | { [key: string]: string }[];
        let endpoint: BDTLL.CloudEndpoints = BDTLL.CloudEndpoints.URL_STATUS;
        let result: BDTLL.PageStatus | BDTLL.PageStatus[];

        if (url instanceof Array) {
            endpoint = BDTLL.CloudEndpoints.URL_BATCH_STATUS;
            requestData = url
                .filter((item: string) => {
                    if (!(CloudTalk.cloudCache[item] || CloudTalk.cloudCache[BDTLL.Utils.extractRootDomain(item)])) {
                        return true;
                    }

                    return false;
                })
                .map((item: string) => ({ url: item }));

            if (requestData.length === 0) {
                return url.map(item => CloudTalk.cloudCache[item] || CloudTalk.cloudCache[BDTLL.Utils.extractRootDomain(item)]);
            }
        } else {
            if (CloudTalk.cloudCache[url]) {
                return CloudTalk.cloudCache[url];
            }

            if (CloudTalk.cloudCache[BDTLL.Utils.extractRootDomain(url)]) {
                return CloudTalk.cloudCache[BDTLL.Utils.extractRootDomain(url)];
            }

            requestData = {
                url: url
            };
        }

        const fetchResponse: BDTLL.PageStatus | BDTLL.PageStatus[] = await fetch(`${BDTLL.CLOUD_SERVER}/${endpoint}`, {
            method: "POST",
            headers: this.getRequestHeaders(),
            body: JSON.stringify(requestData)
        }).then((response: Response) => {
            return response.json();
        }).then(async (response: ICloudResponse | ICloudResponse[]) => {
            if (response instanceof Array) {
                const verdicts = await Promise.all(
                    response.map(async (item: ICloudResponse, index: number) => {
                        const verdict = await CloudTalk.extractVerdict(item);
                        const requestDataItem = (requestData as {[key: string] : string}[])[index];
                        let cachedUrl: string = item.domain_grey ? requestDataItem.url : BDTLL.Utils.extractRootDomain(requestDataItem.url);
                        
                        CloudTalk.cloudCache[cachedUrl] = verdict.status;
                        setTimeout(() => {
                            if (BDTLL.DEBUG_MODE) {
                                console.log(`CloudTalk: Removing cache for ${cachedUrl} after ${CloudTalk.cacheTimeout / 1000} seconds`);
                            }
                            delete CloudTalk.cloudCache[cachedUrl];
                        }, CloudTalk.cacheTimeout);

                        return verdict.status;
                    })
                );
                return verdicts;
            } else {
                const verdict = await CloudTalk.extractVerdict(response);
                const requestDataItem = (requestData as {[key: string] : string});
                let cachedUrl: string = verdict.domainGrey ? requestDataItem.url : BDTLL.Utils.extractRootDomain(requestDataItem.url);
                
                CloudTalk.cloudCache[cachedUrl] = verdict.status;
                setTimeout(() => {
                    if (BDTLL.DEBUG_MODE) {
                        console.log(`CloudTalk: Removing cache for ${cachedUrl} after ${CloudTalk.cacheTimeout / 1000} seconds`);
                    }
                    delete CloudTalk.cloudCache[cachedUrl];
                }, CloudTalk.cacheTimeout);

                return verdict.status;
            }
        }).catch((error: Error) => {
            if (BDTLL.DEBUG_MODE) {
                console.error(`Cloud error: ${error}`);
            }

            if (endpoint === BDTLL.CloudEndpoints.URL_STATUS) {
                return BDTLL.PageStatus.SAFE;
            } else if (endpoint === BDTLL.CloudEndpoints.URL_BATCH_STATUS && url instanceof Array) {
                return url.map(() => BDTLL.PageStatus.SAFE);
            } else {
                return null;
            }
        });

        if (requestData instanceof Array) {
            let index: number = 0;
            result = (url as string[]).map((item: string) => {
                if (CloudTalk.cloudCache[item]) {
                    return CloudTalk.cloudCache[item];
                }

                if (CloudTalk.cloudCache[BDTLL.Utils.extractRootDomain(item)]) {
                    return CloudTalk.cloudCache[BDTLL.Utils.extractRootDomain(item)];
                }

                return fetchResponse[index++] as BDTLL.PageStatus;
            });
        } else {
            result = fetchResponse as BDTLL.PageStatus;
        }

        return result;
    }

    static async bucketTestingSettingsRequest(requestBody: string): Promise<Response> {
        const fetchResponse = await fetch(`${BDTLL.CLOUD_SERVER}/${BDTLL.CloudEndpoints.BUCKET_TESTING}`, {
            method: "POST",
            headers: this.getRequestHeaders(),
            body: requestBody
        })

        return fetchResponse;
    }

    static getRequestHeaders(): HeadersInit {
        return {
            'Content-Type': 'application/json',
            'X-Nimbus-ClientId': BDTLL.BrowserConsts.BROWSER_CLIENTID || '',
        };
    }
}