/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";

export interface ISwitchable {
    enable(setting: BDTLL.SettingType): void;
    disable(setting: BDTLL.SettingType): void;
}

export interface ISettings {
    get(setting: BDTLL.SettingType): Promise<boolean>;
    set(setting: BDTLL.SettingType, value: boolean): Promise<void>;
    listen(): void;
}

export class Settings implements ISettings {
    modules: Array<BDTLL.ISwitchable>;

    constructor(modules: Array<BDTLL.ISwitchable>) {
        this.modules = modules;
        this.init(BDTLL.SettingType.THREAT_FILTER);
        this.init(BDTLL.SettingType.SEARCH_ANALYZER);
        this.listen();
    }

    async init(setting: BDTLL.SettingType): Promise<void> {
        BDTLL.Storage.get(setting).then((value: BDTLL.StorageData) => {
            const val: boolean = (value == null ? true : (value === "true" || value === true));
            this.set(setting, val);
        }).catch(() => {
            this.set(setting, true);
        });
    }

    async get(setting: BDTLL.SettingType): Promise<boolean> {
        let value: string | boolean = true;
        try {
            value = await BDTLL.Storage.get(setting) as string | boolean;
        } catch (error) { }

        return (value === "true" || value === true);
    }

    async set(setting: BDTLL.SettingType, value: boolean): Promise<void> {
        for (let module of this.modules) {
            value ? module.enable(setting) : module.disable(setting);
        }

        return BDTLL.Storage.set(setting, String(value));
    }

    listen(): void {
        BDTLL.MessageService.addListener(
            (message: BDTLL.IMessage) => {
                switch(message.command) {
                    case BDTLL.Command.GET_SETTING:
                        return this.get(message.type)
                    case BDTLL.Command.SET_SETTING:
                        return this.set(message.type, message.enabled);
                }
            }
        );
    }
}