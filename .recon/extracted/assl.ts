/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";

export interface IAssl {
	signCreated: number;
	sign: IRule[];
	nosign: IRule[];
	createRegexes(): Promise<number>;
	scan(sign: IRule[], nosign: IRule[], meta: string, bodyRaw: string, bodyDecoded: string, url: string, title: string, domain: string, scripts: string[]): IRule;
}

export interface IRule {
	name: string,
	action: string,
	type?: string,
	score?: string,
	priority?: number,
	regex?: RegExp,
	part?: string,
	param?: string,
	encoding?: string,
	exec?: string,
	rules?: string
}

export interface IRunRuleResult {
	verdict: boolean,
	scripts: string[]
}

export class Assl implements IAssl {
	//----> Structures that hold the rules,metarules and metarules that have no action<------
	internalRule: IRule;
	signCreated: number = 0;
	sign: IRule[];
	nosign: IRule[];

	constructor() {}

	async createRegexes(): Promise<number> {
		if (typeof (this.sign) == "undefined" || (typeof (this.sign) != "undefined" && this.sign.length == 0)) {
			this.sign = [];
			this.nosign = [];
			let slfContent: string;
			try {
				slfContent = await BDTLL.Storage.get(BDTLL.StorageKeys.SLF_CONTENT) as string;
			} catch (error) { }

			const ruleParse: RegExp = /^(rule|metarule)\s+(.*?)\s+{\s+condition:\s+(.*?);\s+actions:\s+(.*?);\s+metadata:\s+(.*?);/mg;
			let match: RegExpExecArray = ruleParse.exec(slfContent);

			while (match != null) {
				const matchRegex: RegExp = /match\("(.*)",\s*(.*?)\s*,\s*(.*?)\s*(,\s*(.*?))?\)|exec\((.*?)\)|(.*)/mgi;
				const actionRegex: RegExp = /mark\("(.*?)"\s*,\s*(\d+)\)|(.*)/mgi;
				const metadataRegex: RegExp = /priority\s*=\s*(\d+)|(.*)/mgi;

				const regExtract: RegExpExecArray = matchRegex.exec(match[3]);
				const actionsExtract: RegExpExecArray = actionRegex.exec(match[4]);
				const metadataExtract: RegExpExecArray = metadataRegex.exec(match[5]);

				let currentRule: IRule;
				if (regExtract[1] != null) {
					let reg: RegExp;
					try {
						if (regExtract[3] == "REGEX_INSENSITIVE") {
							reg = new RegExp(regExtract[1], "i");
						} else {
							reg = new RegExp(regExtract[1]);
						}
					} catch (error) {
						reg = null;
					}

					currentRule = {
						type: match[1],
						name: match[2],
						regex: reg,
						part: regExtract[2],
						param: regExtract[3],
						encoding: regExtract[5],
						action: actionsExtract[1],
						score: actionsExtract[2],
						priority: parseInt(metadataExtract[1])
					}
				} else if (regExtract[6] != null) {
					currentRule = {
						type: match[1],
						name: match[2],
						exec: regExtract[6],
						action: actionsExtract[1],
						score: actionsExtract[2],
						priority: parseInt(metadataExtract[1])
					}
				} else if (regExtract[7] != null) {
					currentRule = {
						type: match[1],
						name: match[2],
						rules: regExtract[7],
						action: actionsExtract[1],
						score: actionsExtract[2],
						priority: parseInt(metadataExtract[1])
					}
				}
				if (currentRule.action != null) {
					this.sign.push(currentRule);
				} else {
					this.nosign.push(currentRule);
				}

				match = ruleParse.exec(slfContent);
			}

			this.sign.sort((a: IRule, b: IRule) => {
				return b.priority - a.priority
			});

		}
		return 1;
	}

	scan(sign: IRule[], nosign: IRule[], meta: string, bodyRaw: string, bodyDecoded: string, url: string, title: string, domain: string, scripts: string[]): IRule {
		let name = "";
		for (let i = 0; i < sign.length; i++) {
			if ((sign[i].type == "rule") && (sign[i].action != null)) {
				const result = BDTLL.AsslCommon.runRule(sign[i], meta, bodyRaw, bodyDecoded, url, title, domain, scripts)
				if (result.verdict == true) {
					if (sign[i].action == "PHISHING" || sign[i].action == "LEGIT") {
						name = sign[i].name;
						return {
							action: sign[i].action,
							name: name
						};
					}
				}
			} else if ((sign[i].type == "metarule") && (sign[i].action != null)) {
				try {
					const runmeta = BDTLL.AsslCommon.runMetaRule(sign[i], nosign, meta, bodyRaw, bodyDecoded, url, title, domain, scripts);
					if (runmeta.verdict == true) {
						if (sign[i].action == "PHISHING" || sign[i].action == "LEGIT") {
							name = sign[i].name;
							return {
								action: sign[i].action,
								name: name
							};
						}
					}
				} catch (error) { }
			}
		}

		return {
			action: "IGNORE",
			name: "IGNORE"
		};
	}

}