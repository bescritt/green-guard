import * as BDTLL from "../BDTLL";

interface IBucketTestingParams {
    protocol_version: number,
    metadata: {
        app_id: string,
        app_version: string,
        current_buckets: string[]
    },
    fields?: {
        anon_id?: string,
        subscription_type?: number
        country?: string,
        lang?: string
    }
}

export enum BucketTestingMethod {
    GET_SETTINGS = "get_settings",
    REMOVE_USER = "remove_user"
}

interface IBucketTestingRequest {
    id: number,
    jsonrpc: string,
    method: BucketTestingMethod,
    params: IBucketTestingParams
}

export interface IBucketTestingResponse {
    id: number,
    jsonrpc: string,
    result?: {
        settings: IBucketTestingSettings,
        ids: string[]
    },
    error?: {
        code: number,
        message: string,
        data: {
            code: number,
            message: string
        }
    }
}

export interface IBucketTestingSettings {
    fb_adds_state: boolean
}

export class BucketTesting {
    static bucketTestingUpdateInterval: number = 24 * 60 * 60 * 1000;
    static settings: IBucketTestingSettings = null;
    private static listeners: Set<Function> = new Set();
    private static updateTimeoutId: number | null = null;

    static addListener(callback: Function): void {
        this.listeners.add(callback);
    }

    static removeListener(callback: Function): void {
        this.listeners.delete(callback);
    }

    static hasListener(callback: Function): boolean {
        return this.listeners.has(callback);
    }

    static notifyListeners(): void {
        this.listeners.forEach(callback => callback());
    }

    static async updateBucketTestingSettings(): Promise<void> {
        const lastBucketTestingRequestTime: number = await BDTLL.Storage.get(BDTLL.StorageKeys.LAST_BUCKET_TESTING_REQUEST_TIME) as number || Date.now();
        const lastValidResponse: IBucketTestingSettings = await BDTLL.Storage.get(BDTLL.StorageKeys.BUCKET_TESTING_SETTINGS) as IBucketTestingSettings;
        const currentTime: number = Date.now();
        const shouldUpdate: boolean = await BucketTesting.checkUpdateInterval(lastBucketTestingRequestTime, lastValidResponse);

        if (!shouldUpdate) {
            if (BDTLL.DEBUG_MODE) {
                console.log("Bucket Testing: No update needed");
            }
            await BucketTesting.scheduleNextUpdate();
            return;
        }

        await BDTLL.Storage.set(BDTLL.StorageKeys.LAST_BUCKET_TESTING_REQUEST_TIME, currentTime);
        const currentBuckets: string[] = await BDTLL.Storage.get(BDTLL.StorageKeys.CURRENT_BUCKETS) as string[] || [];
        const requestData: IBucketTestingRequest = {
            id: 1,
            jsonrpc: "2.0",
            method: BDTLL.BucketTestingMethod.GET_SETTINGS,
            params: {
                protocol_version: 1,
                metadata: {
                    app_id: `com.${BDTLL.Consts.COMPANY_NAME}.tll`.toLowerCase(),
                    app_version: `${BDTLL.Consts.VERSION}`,
                    current_buckets: currentBuckets
                },
                fields: {
                    lang: BDTLL.Consts.DEFAULT_LOCALE
                }
            }
        };
        const jsonString: string = JSON.stringify(requestData);

        if (BDTLL.DEBUG_MODE) {
            console.log("Bucket Testing: Sending request", jsonString);
        }

        const responseJSON = await BDTLL.CloudTalk.bucketTestingSettingsRequest(jsonString)
            .then(async (response: Response) => {
                const responseJSON: BDTLL.IBucketTestingResponse = await response.json();

                if (BDTLL.DEBUG_MODE) {
                    console.log("Bucket Testing: Received response", responseJSON);
                }

                if (responseJSON.error) {
                    if (BDTLL.DEBUG_MODE) {
                        console.error(`Bucket Testing Error`, responseJSON.error);
                    }

                    return {
                        id: responseJSON.id,
                        jsonrpc: responseJSON.jsonrpc,
                        result: {
                            settings: {
                                fb_adds_state: lastValidResponse?.fb_adds_state || false
                            },
                            ids: [] as string[]
                        }
                    };
                }

                await BDTLL.Storage.set(BDTLL.StorageKeys.BUCKET_TESTING_SETTINGS, responseJSON.result.settings);
                return responseJSON;
            }).catch(async (error: Error) => {
                if (BDTLL.DEBUG_MODE) {
                    console.error(`Cloud error: ${error}`);
                }

                return {
                    result: {
                        settings: {
                            fb_adds_state: lastValidResponse?.fb_adds_state || false
                        },
                        ids: [] as string[]
                    }
                };
            });

        responseJSON.result.ids.forEach((bucketId: string) => {
            if (currentBuckets.indexOf(bucketId) === -1) {
                currentBuckets.push(bucketId);
            }
        });

        await BDTLL.Storage.set(BDTLL.StorageKeys.CURRENT_BUCKETS, currentBuckets);
        BucketTesting.settings = responseJSON.result.settings;
        await BucketTesting.scheduleNextUpdate();
        this.notifyListeners();
    }

    static async checkUpdateInterval(lastBucketTestingRequestTime: number, lastValidResponse: IBucketTestingSettings): Promise<boolean> {
        const currentTime: number = Date.now();

        if (BucketTesting.settings == null) {
            if (lastValidResponse == null) {
                if (BDTLL.DEBUG_MODE) {
                    console.log("Bucket Testing: Updating settings from server");
                }

                return true;
            } else {
                BucketTesting.settings = lastValidResponse;
            }
        }

        return (BucketTesting.bucketTestingUpdateInterval <= (currentTime - lastBucketTestingRequestTime));
    }

    private static async scheduleNextUpdate(): Promise<void> {
        if (BucketTesting.updateTimeoutId !== null) {
            clearTimeout(BucketTesting.updateTimeoutId);
        }

        let lastBucketTestingRequestTime: number = await BDTLL.Storage.get(BDTLL.StorageKeys.LAST_BUCKET_TESTING_REQUEST_TIME) as number || Date.now();
        const currentTime: number = Date.now();

        // only happens if the storage was manually changed
        if (lastBucketTestingRequestTime > currentTime) {
            if (BDTLL.DEBUG_MODE) {
                console.warn("Bucket Testing: Future timestamp detected, resetting to current time");
            }
            lastBucketTestingRequestTime = currentTime;
            await BDTLL.Storage.set(BDTLL.StorageKeys.LAST_BUCKET_TESTING_REQUEST_TIME, currentTime);
        }

        const timeToNextUpdate: number = BucketTesting.bucketTestingUpdateInterval - (currentTime - lastBucketTestingRequestTime);

        // Clamp to JavaScript's setTimeout max (24.8 days) to prevent integer overflow
        const MAX_TIMEOUT: number = 2147483647; // Max 32-bit signed integer
        const safeDelay: number = Math.min(Math.max(timeToNextUpdate, 1000), MAX_TIMEOUT);

        BucketTesting.updateTimeoutId = setTimeout(() => {
            void BucketTesting.updateBucketTestingSettings();
        }, safeDelay) as any;

        if (BDTLL.DEBUG_MODE) {
            console.log("Bucket Testing: Next update scheduled in", safeDelay / 1000, "seconds");
        }
    }
}