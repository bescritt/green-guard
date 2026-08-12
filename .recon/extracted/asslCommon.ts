/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";

interface IMetaRule {
    rule: BDTLL.IRule,
    hit: boolean
}

export class AsslCommon {
    static getPath(url: string): string {
        let pathRegex: RegExp;

        if (url.indexOf('?') < 0) {
            pathRegex = /(http|https):\/\/.*?\/(.*)/;
        } else {
            pathRegex = /(http|https):\/\/.*?\/(.*)\?/;
        }

        const path: RegExpExecArray = pathRegex.exec(url);

        if (typeof (path) != "undefined" && path && typeof (path[2]) != "undefined" && path[2]) {
            return path[2];
        }
    }

    static getParams(url: string): string {
        let params: RegExpExecArray;

        if (url.indexOf('?') > 0) {
            const paramRegex: RegExp = /(http|https):\/\/.*\/.*\?(.*)/;
            params = paramRegex.exec(url);

            return params[2];
        }

        return null;
    }

    static runRule(
        rule: BDTLL.IRule, meta: string, bodyRaw: string, bodyDecoded: string,
        url: string, title: string, domain: string, scripts: string[]): BDTLL.IRunRuleResult {
        let hitScripts: string[];
        if (typeof (rule) != "undefined") {
            let match: Array<string>;
            if (rule.regex != null) {
                if (typeof (rule.regex) == "string") {
                    if (typeof (rule.param) != "undefined" && rule.param) {
                        try {
                            if (rule.param == "REGEX_INSENSITIVE") {
                                rule.regex = new RegExp(rule.regex, "i");
                            } else {
                                rule.regex = new RegExp(rule.regex);
                            }
                        } catch (error) { }
                    }
                }
                if (rule.part == "HTML::Body") {
                    if (rule.encoding != null) {
                        if (rule.encoding == "DECODED") {
                            match = rule.regex.exec(bodyDecoded);
                        } else {
                            match = rule.regex.exec(bodyRaw);
                        }
                    } else {
                        match = rule.regex.exec(bodyRaw);
                    }
                } else if (rule.part == "HTML::Title") {
                    match = rule.regex.exec(title);
                } else if (rule.part == "HTML::Url") {
                    match = rule.regex.exec(url);
                } else if (rule.part == "HTML::Meta") {
                    match = rule.regex.exec(meta);
                } else if (rule.part == "HTML::Script") {
                    for (let i = 0; i < scripts.length; i++) {
                        match = rule.regex.exec(scripts[i]);

                        if (match != null) {
                            hitScripts.push(scripts[i]);
                        }
                        match = null;
                    }
                    if (hitScripts.length > 0) {
                        match = new Array<string>();
                    }
                } else if (rule.part == "Url::Path") {
                    const path: string = BDTLL.AsslCommon.getPath(url);
                    if (typeof (path) != 'undefined' && path) {
                        match = rule.regex.exec(path);
                    }
                } else if (rule.part == "Url::Params") {
                    const params: string = BDTLL.AsslCommon.getParams(url);
                    if (typeof (params) != 'undefined' && params) {
                        match = rule.regex.exec(params);
                    }
                } else if (rule.part == "Url::Host") {
                    match = rule.regex.exec(domain);
                }
            }
            if (match != null) {
                return {
                    verdict: true,
                    scripts: hitScripts
                }
            }
        }
        return {
            verdict: false,
            scripts: hitScripts
        }
    }

    static extractRules(logicalExpression: string): RegExpExecArray[] {
        if (logicalExpression == null)
            return null;
            
        const ruleNameRegExp: RegExp = /[A-Z0-9_]+/mg;
        let ruleName: RegExpExecArray = ruleNameRegExp.exec(logicalExpression);
        let items: RegExpExecArray[];

        while (ruleName != null) {
            items.push(ruleName);
            ruleName = ruleNameRegExp.exec(logicalExpression);
        }

        return items;
    }

    static getRule(ruleName: string, nosign: BDTLL.IRule[]): BDTLL.IRule {
        if (ruleName == null)
            return null;

        for (let i = 0; i < nosign.length; i++) {
            if (nosign[i].name == ruleName) {
                return nosign[i];
            }
        }
    }

    static runMetaRule(
        rule: BDTLL.IRule, nosign: BDTLL.IRule[], meta: string, bodyRaw: string, bodyDecoded: string,
        url: string, title: string, domain: string, scripts: string[]): BDTLL.IRunRuleResult {
        let ruleObjArr: IMetaRule[];
        let hitScripts: string[];

        if (rule.rules != null) {
            const listOfRules: RegExpExecArray[] = this.extractRules(rule.rules);

            for (let i = 0; i < listOfRules.length; i++) {
                const ruleObj: IMetaRule = {
                    rule: listOfRules[i] as unknown as BDTLL.IRule,
                    hit: false
                }
                ruleObjArr.push(ruleObj);

            }
            for (let i = 0; i < ruleObjArr.length; i++) {
                if (ruleObjArr[i].rule.type == "metarule") {
                    const res1: BDTLL.IRunRuleResult = this.runMetaRule(this.getRule(ruleObjArr[i].rule.name, nosign), nosign, meta, bodyRaw, bodyDecoded, url, title, domain, scripts);
                    ruleObjArr[i].hit = res1.verdict;
                    hitScripts = hitScripts.concat(res1.scripts);
                } else {
                    const res2: BDTLL.IRunRuleResult = this.runRule(this.getRule(ruleObjArr[i].rule.name, nosign), meta, bodyRaw, bodyDecoded, url, title, domain, scripts);
                    ruleObjArr[i].hit = res2.verdict;
                    hitScripts = hitScripts.concat(res2.scripts);
                }
            }

            let internal: string = rule.rules;

            if (internal) {
                for (let i = 0; i < ruleObjArr.length; i++) {
                    internal = internal.replace(ruleObjArr[i].rule.regex, ruleObjArr[i].hit as unknown as string);
                }
                internal = internal.replace(/\&\&\&/g, "&&");
                internal = internal.replace(/\|\|\|/g, "||");
            }
            const evalexpr: boolean = BDTLL.Utils.evaluateExpression(internal);

            return {
                verdict: evalexpr,
                scripts: hitScripts
            };
        }
    }
}