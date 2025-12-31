type TimeScale = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

interface DurationResult {
    duration: number;
    scale: TimeScale;
}

interface FormatterCache {
    long: Intl.DateTimeFormat;
    short: Intl.DateTimeFormat;
}

const YEAR: TimeScale = 'year';
const MONTH: TimeScale = 'month';
const DAY: TimeScale = 'day';
const HOUR: TimeScale = 'hour';
const MINUTE: TimeScale = 'minute';
const SECOND: TimeScale = 'second';
const MILLISECOND: TimeScale = 'millisecond';

const formatterCache = new Map<string, FormatterCache>();

const DURATION_REGEX = /([0-9]+)(y|min|ms|m|d|h|s)/gm;

const FORMAT_KEYS_SORTED = ['YYYY', 'MMMM', 'MMM', 'SSS', 'MM', 'DD', 'HH', 'mm', 'ss', 'D'];

function getFormatters(lang: string): FormatterCache {
    let cached = formatterCache.get(lang);
    if (!cached) {
        cached = {
            long: new Intl.DateTimeFormat(lang, { month: 'long' }),
            short: new Intl.DateTimeFormat(lang, { month: 'short' }),
        };
        formatterCache.set(lang, cached);
    }
    return cached;
}

function padStart(str: string | number, targetLength: number, padString: string | number = ' '): string {
    let s = str + '';
    targetLength = targetLength >> 0;
    let ps = String(padString);
    if (s.length > targetLength) {
        return s;
    } else {
        targetLength = targetLength - s.length;
        if (targetLength > ps.length) {
            ps += ps.repeat(targetLength / ps.length);
        }
        return ps.slice(0, targetLength) + s;
    }
}

const date_utils = {
    parse_duration(duration: string): DurationResult | undefined {
        DURATION_REGEX.lastIndex = 0;
        const matches = DURATION_REGEX.exec(duration);
        if (matches !== null && matches[1] && matches[2]) {
            const value = parseInt(matches[1], 10);
            const unit = matches[2];
            if (unit === 'y') return { duration: value, scale: 'year' };
            if (unit === 'm') return { duration: value, scale: 'month' };
            if (unit === 'd') return { duration: value, scale: 'day' };
            if (unit === 'h') return { duration: value, scale: 'hour' };
            if (unit === 'min') return { duration: value, scale: 'minute' };
            if (unit === 's') return { duration: value, scale: 'second' };
            if (unit === 'ms') return { duration: value, scale: 'millisecond' };
        }
        return undefined;
    },

    parse(date: string | Date, date_separator = '-', time_separator: string | RegExp = /[.:]/): Date {
        if (date instanceof Date) {
            return date;
        }
        if (typeof date === 'string') {
            const parts = date.split(' ');
            const datePart = parts[0] ?? '';
            const date_parts = datePart
                .split(date_separator)
                .map((val) => parseInt(val, 10));
            const timePart = parts[1];
            const time_parts = timePart ? timePart.split(time_separator) : undefined;

            const year = date_parts[0] ?? 0;
            const month = (date_parts[1] ?? 1) - 1;
            const day = date_parts[2] ?? 1;

            let vals: number[] = [year, month, day];

            if (time_parts && time_parts.length) {
                const parsed_time = time_parts.map((v, i) => {
                    if (i === 3) {
                        return parseFloat('0.' + v) * 1000;
                    }
                    return parseInt(v, 10);
                });
                vals = vals.concat(parsed_time);
            }
            return new Date(vals[0] ?? 0, vals[1] ?? 0, vals[2] ?? 1, vals[3] ?? 0, vals[4] ?? 0, vals[5] ?? 0, vals[6] ?? 0);
        }
        return new Date();
    },

    to_string(date: Date, with_time = false): string {
        if (!(date instanceof Date)) {
            throw new TypeError('Invalid argument type');
        }
        const [year, month, day, hour, min, sec, ms] = this.get_date_values(date);
        const vals = [
            padStart(year + '', 4, '0'),
            padStart((month + 1) + '', 2, '0'),
            padStart(day + '', 2, '0'),
            padStart(hour + '', 2, '0'),
            padStart(min + '', 2, '0'),
            padStart(sec + '', 2, '0'),
            padStart(ms + '', 3, '0'),
        ];
        const date_string = `${vals[0]}-${vals[1]}-${vals[2]}`;
        const time_string = `${vals[3]}:${vals[4]}:${vals[5]}.${vals[6]}`;

        return date_string + (with_time ? ' ' + time_string : '');
    },

    format(date: Date, date_format = 'YYYY-MM-DD HH:mm:ss.SSS', lang = 'en'): string {
        const formatters = getFormatters(lang);
        const month_name = formatters.long.format(date);
        const month_name_capitalized =
            month_name.charAt(0).toUpperCase() + month_name.slice(1);

        const [year, month, day, hour, min, sec, ms] = this.get_date_values(date);
        const values = [year, month, day, hour, min, sec, ms].map((d) => padStart(d, 2, '0'));
        const format_map: Record<string, string> = {
            YYYY: values[0]!,
            MM: padStart(+values[1]! + 1, 2, '0'),
            DD: values[2]!,
            HH: values[3]!,
            mm: values[4]!,
            ss: values[5]!,
            SSS: values[6]!,
            D: values[2]!,
            MMMM: month_name_capitalized,
            MMM: formatters.short.format(date),
        };

        let str = date_format;
        const formatted_values: string[] = [];

        FORMAT_KEYS_SORTED.forEach((key) => {
            if (str.includes(key)) {
                str = str.replaceAll(key, `$${formatted_values.length}`);
                const val = format_map[key];
                if (val) formatted_values.push(val);
            }
        });

        formatted_values.forEach((value, i) => {
            str = str.replaceAll(`$${i}`, value);
        });

        return str;
    },

    diff(date_a: Date, date_b: Date, scale: TimeScale | string = 'day'): number {
        const milliseconds =
            date_a.getTime() -
            date_b.getTime() +
            (date_b.getTimezoneOffset() - date_a.getTimezoneOffset()) * 60000;
        const seconds = milliseconds / 1000;
        const minutes = seconds / 60;
        const hours = minutes / 60;
        const days = hours / 24;

        const yearDiff = date_a.getFullYear() - date_b.getFullYear();
        let monthDiff = date_a.getMonth() - date_b.getMonth();
        monthDiff += (days % 30) / 30;

        let months = yearDiff * 12 + monthDiff;
        if (date_a.getDate() < date_b.getDate()) {
            months--;
        }

        const years = months / 12;

        let s = scale;
        if (!s.endsWith('s')) {
            s += 's';
        }

        const scales: Record<string, number> = {
            milliseconds,
            seconds,
            minutes,
            hours,
            days,
            months,
            years,
        };

        return Math.round((scales[s] ?? 0) * 100) / 100;
    },

    today(): Date {
        const vals = this.get_date_values(new Date()).slice(0, 3) as [number, number, number];
        return new Date(vals[0], vals[1], vals[2]);
    },

    now(): Date {
        return new Date();
    },

    add(date: Date, qty: number | string, scale: TimeScale): Date {
        const q = typeof qty === 'string' ? parseInt(qty, 10) : qty;
        const vals: [number, number, number, number, number, number, number] = [
            date.getFullYear() + (scale === YEAR ? q : 0),
            date.getMonth() + (scale === MONTH ? q : 0),
            date.getDate() + (scale === DAY ? q : 0),
            date.getHours() + (scale === HOUR ? q : 0),
            date.getMinutes() + (scale === MINUTE ? q : 0),
            date.getSeconds() + (scale === SECOND ? q : 0),
            date.getMilliseconds() + (scale === MILLISECOND ? q : 0),
        ];
        return new Date(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6]);
    },

    start_of(date: Date, scale: TimeScale): Date {
        const scores: Record<TimeScale, number> = {
            year: 6,
            month: 5,
            day: 4,
            hour: 3,
            minute: 2,
            second: 1,
            millisecond: 0,
        };

        function should_reset(_scale: TimeScale): boolean {
            const max_score = scores[scale];
            return scores[_scale] <= max_score;
        }

        const vals: [number, number, number, number, number, number, number] = [
            date.getFullYear(),
            should_reset(YEAR) ? 0 : date.getMonth(),
            should_reset(MONTH) ? 1 : date.getDate(),
            should_reset(DAY) ? 0 : date.getHours(),
            should_reset(HOUR) ? 0 : date.getMinutes(),
            should_reset(MINUTE) ? 0 : date.getSeconds(),
            should_reset(SECOND) ? 0 : date.getMilliseconds(),
        ];

        return new Date(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6]);
    },

    clone(date: Date): Date {
        const vals = this.get_date_values(date);
        return new Date(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6]);
    },

    get_date_values(date: Date): [number, number, number, number, number, number, number] {
        return [
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            date.getMilliseconds(),
        ];
    },

    convert_scales(period: string, to_scale: TimeScale): number {
        const TO_DAYS: Record<TimeScale, number> = {
            millisecond: 1 / 60 / 60 / 24 / 1000,
            second: 1 / 60 / 60 / 24,
            minute: 1 / 60 / 24,
            hour: 1 / 24,
            day: 1,
            month: 30,
            year: 365,
        };
        const parsed = this.parse_duration(period);
        if (!parsed) return 0;
        const { duration, scale } = parsed;
        const in_days = duration * TO_DAYS[scale];
        return in_days / TO_DAYS[to_scale];
    },

    get_days_in_month(date: Date): number {
        const no_of_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const month = date.getMonth();

        if (month !== 1) {
            return no_of_days[month] ?? 30;
        }

        const year = date.getFullYear();
        if ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) {
            return 29;
        }
        return 28;
    },

    get_days_in_year(date: Date): number {
        return date.getFullYear() % 4 ? 365 : 366;
    },

    // camelCase aliases
    parseDuration(duration: string): DurationResult | undefined {
        return this.parse_duration(duration);
    },
    toString(date: Date, withTime = false): string {
        return this.to_string(date, withTime);
    },
    startOf(date: Date, scale: TimeScale): Date {
        return this.start_of(date, scale);
    },
    getDateValues(date: Date): [number, number, number, number, number, number, number] {
        return this.get_date_values(date);
    },
    convertScales(period: string, toScale: TimeScale): number {
        return this.convert_scales(period, toScale);
    },
    getDaysInMonth(date: Date): number {
        return this.get_days_in_month(date);
    },
    getDaysInYear(date: Date): number {
        return this.get_days_in_year(date);
    },
};

export default date_utils;
export type { TimeScale, DurationResult };
