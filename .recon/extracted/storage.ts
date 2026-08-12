/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLLCommon";
import { IBucketTestingSettings } from "./bucketTesting";
import Browser = require("webextension-polyfill");

export type StorageData = boolean | number | string | string[] | Record<string, BDTLL.WebPage> |
    BDTLL.IStoredConversationStatus | IBucketTestingSettings;

export class Storage {
    static async get(key: string): Promise<StorageData> {
        return (await Browser.storage.local.get(key))[key];
    }

    static async set(key: string, value: StorageData): Promise<void> {
        const obj = { [key]: value };
        return Browser.storage.local.set(obj);
    }

    static async remove(key: string): Promise<void> {
        return await Browser.storage.local.remove(key);
    }
}