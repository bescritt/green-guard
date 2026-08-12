import * as BDTLL from "../../../BDTLLCommon";

interface IDatePositions {
    day: number;
    month: number;
    monthIsNumeric: boolean;
    year: number;
}

interface ITimePositions {
    hour: number;
    minute: number;
    dayPeriod: number;
}

interface IRegexComponent {
    pattern: RegExp;
    positions: IDatePositions | ITimePositions;
    example: string;
}

interface IRegexes {
    date: IRegexComponent[];
    time: IRegexComponent[];
}

interface IParsedDate {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

export class LocaleTimestampParser {
    static monthMappings: Map<string, Map<string, number>> = new Map<string, Map<string, number>>();
    static regexes: Map<string, IRegexes> = new Map<string, IRegexes>();

    static convert12HourFormatTo24HourFormat(hour: number, ampm: string): number {
        let hour24: number = hour;
        if (ampm.toUpperCase() === 'PM' && hour24 !== 12) {
            hour24 += 12;
        } else if (ampm.toUpperCase() === 'AM' && hour24 === 12) {
            hour24 = 0;
        }
        return hour24;
    }

    // TODO: could cover weekdays as well
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
    static generateRegexes(siteLocale: string): void {
        LocaleTimestampParser.regexes.set(siteLocale, {
            date: [],
            time: []
        });

        const dateOptions: Intl.DateTimeFormatOptions[] = [
            { dateStyle: 'short' },   // 12/12/2025
            { dateStyle: 'medium' },  // Oct 10, 2025
            { dateStyle: 'long' },    // October 10, 2025
            { dateStyle: 'full' }     // Saturday, October 10, 2025
        ];

        for (const option of dateOptions) {
            const formatter: Intl.DateTimeFormat = new Intl.DateTimeFormat(siteLocale, option);
            const testDate: Date = new Date(2022, 4, 20);
            const parts: Intl.DateTimeFormatPart[] = formatter.formatToParts(testDate);

            let patternStr: string = '';
            const positions: IDatePositions = { day: 0, month: 0, monthIsNumeric: false, year: 0 };
            let groupIndex: number = 1;

            parts.forEach(part => {
                switch (part.type) {
                    case 'literal':
                        patternStr += part.value.replace(/,/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        break;
                    case 'day':
                        patternStr += '(\\d{1,2})';
                        positions.day = groupIndex++;
                        break;
                    case 'month':
                        if (/^\d+$/.test(part.value)) {
                            patternStr += '(\\d{1,2})';
                            positions.month = groupIndex++;
                            positions.monthIsNumeric = true;
                        } else {
                            patternStr += '([A-Za-zÀ-ÿ]+\\.?)';
                            positions.month = groupIndex++;
                            positions.monthIsNumeric = false;
                        }
                        break;
                    case 'year':
                        patternStr += '(\\d{2,4})';
                        positions.year = groupIndex++;
                        break;
                }
            });

            patternStr = patternStr.replace(/[\u25A0\u00A0\s]+/g, ' ');

            LocaleTimestampParser.regexes.get(siteLocale).date.push({
                pattern: new RegExp(patternStr, 'i'),
                positions: positions,
                example: formatter.format(testDate)
            });
        }

        const timeOptions: Intl.DateTimeFormatOptions[] = [
            { timeStyle: 'short' },  // 6:10 PM or 18:10
            { timeStyle: 'medium' }, // 6:10:10 PM or 18:10:10
            { timeStyle: 'long' },   // 6:10:10 PM GMT+2 or 18:10:10 GMT+2
            { timeStyle: 'full' }    // 6:10:10 PM GMT+2 or 18:10:10 GMT+2
        ];

        for (const option of timeOptions) {
            const formatter: Intl.DateTimeFormat = new Intl.DateTimeFormat(siteLocale, option);
            const testDate: Date = new Date(2022, 4, 20, 18, 10, 0);
            const parts: Intl.DateTimeFormatPart[] = formatter.formatToParts(testDate);

            let patternStr: string = '';
            const positions: ITimePositions = { hour: 0, minute: 0, dayPeriod: 0 };
            let groupIndex: number = 1;

            for (let i = 0; i < parts.length; i++) {
                const part: Intl.DateTimeFormatPart = parts[i];
                const nextPart: Intl.DateTimeFormatPart | undefined = parts[i + 1];
                switch (part.type) {
                    case 'literal':
                        if (nextPart?.type === 'dayPeriod' && part.value.trim() === '') {
                            break;
                        }
                        patternStr += part.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        break;
                    case 'hour':
                        patternStr += '(\\d{1,2})';
                        positions.hour = groupIndex++;
                        break;
                    case 'minute':
                        patternStr += '(\\d{1,2})';
                        positions.minute = groupIndex++;
                        break;
                    case 'second':
                        patternStr += '(\\d{1,2})';
                        groupIndex++;
                        break;
                    case 'dayPeriod':
                        patternStr += '(?:\\s*([AaPp]\\.?[Mm]\\.?))?';
                        positions.dayPeriod = groupIndex++;
                        break;
                }
            }

            patternStr = patternStr.replace(/[\u25A0\u00A0\s]+/g, ' ');

            LocaleTimestampParser.regexes.get(siteLocale).time.push({
                pattern: new RegExp(patternStr, 'i'),
                positions: positions,
                example: formatter.format(testDate)
            });
        }
    }

    static getDate(dateString: string, siteLocale: string): IParsedDate | null {
        const regexes: IRegexes | undefined = LocaleTimestampParser.regexes.get(siteLocale);

        let dateMatch: RegExpMatchArray | null = null;
        let datePositions: IDatePositions | null = null;
        for (const dateRegex of regexes.date) {
            dateMatch = dateString.match(dateRegex.pattern);
            if (dateMatch) {
                datePositions = dateRegex.positions as IDatePositions;
                break;
            }
        }

        let timeMatch: RegExpMatchArray | null = null;
        let timePositions: ITimePositions | null = null;
        for (const timeRegex of regexes.time) {
            timeMatch = dateString.match(timeRegex.pattern);
            if (timeMatch) {
                timePositions = timeRegex.positions as ITimePositions;
                break;
            }
        }

        if (!dateMatch && !timeMatch) {
            if (BDTLL.DEBUG_MODE) {
                console.warn(`Could not parse date string: ${dateString}`);
            }
            return null;
        }

        const today: Date = new Date();
        let year: number = today.getFullYear();
        let month: number = today.getMonth();
        let day: number = today.getDate();

        if (dateMatch && datePositions) {
            year = datePositions.year ? parseInt(dateMatch[datePositions.year]) : new Date().getFullYear();
            if (year < 100) {
                year += year < 50 ? 2000 : 1900;
            }

            if (datePositions.monthIsNumeric) {
                month = parseInt(dateMatch[datePositions.month]) - 1;
            } else {
                if (!dateMatch[datePositions.month]) {
                    if (BDTLL.DEBUG_MODE) {
                        console.warn(`Month group not captured for: ${dateString}`);
                    }
                    return null;
                }
                const monthText: string = dateMatch[datePositions.month].toLowerCase().replace('.', '').trim();
                month = LocaleTimestampParser.monthMappings.get(siteLocale).get(monthText);

                if (month === undefined) {
                    for (const [key, value] of LocaleTimestampParser.monthMappings.get(siteLocale)) {
                        if (key.startsWith(monthText) || monthText.startsWith(key)) {
                            month = value;
                            break;
                        }
                    }
                }

                if (month === undefined) {
                    if (BDTLL.DEBUG_MODE) {
                        console.warn(`Could not resolve month: ${monthText}`);
                    }
                    return null;
                }
            }

            day = datePositions.day ? parseInt(dateMatch[datePositions.day]) : 1;
        }

        let hour = 0;
        let minute = 0;

        if (timeMatch && timePositions) {
            hour = timePositions.hour ? parseInt(timeMatch[timePositions.hour]) : 0;
            minute = timePositions.minute ? parseInt(timeMatch[timePositions.minute]) : 0;

            if (timePositions.dayPeriod && timeMatch[timePositions.dayPeriod]) {
                hour = LocaleTimestampParser.convert12HourFormatTo24HourFormat(hour, timeMatch[timePositions.dayPeriod]);
            }
        }

        return {
            year: year,
            month: month,
            day: day,
            hour: hour,
            minute: minute
        };
    }

    /*
    * @param {string} dateString - The date string to parse, expects format: 2 oct. 2025, 15:06 or Feb 7, 2025, 12:24 PM or numeric locale format
    * @returns {number} - The timestamp in milliseconds
    */
    static parse(dateString: string, locale: string = null): number {
        const siteLocale: string = locale || document.documentElement.lang || navigator.language;
        dateString = dateString.replace(/[\u25A0\u00A0\s,]+/g, ' '); // replace non-breaking spaces and spaces with a single space

        if (LocaleTimestampParser.monthMappings.get(siteLocale) === undefined) {
            LocaleTimestampParser.monthMappings.set(siteLocale, new Map());
            for (let i = 0; i < 12; i++) {
                const monthName: string = new Intl.DateTimeFormat(siteLocale, { month: 'short' }).format(new Date(2000, i, 1))
                    .toLowerCase()
                    .replace('.', '')
                    .trim();
                LocaleTimestampParser.monthMappings.get(siteLocale).set(monthName, i);
            }

            LocaleTimestampParser.generateRegexes(siteLocale);
        }

        const datetime: IParsedDate | null = LocaleTimestampParser.getDate(dateString, siteLocale);

        if (datetime === null) {
            if (BDTLL.DEBUG_MODE) {
                console.warn(`Could not parse date string: ${dateString} with locale: ${siteLocale}`);
            }
            return Date.now();
        }

        return new Date(datetime.year, datetime.month, datetime.day, datetime.hour, datetime.minute).getTime();
    }
}