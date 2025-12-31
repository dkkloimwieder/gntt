import date_utils from './date_utils';
import type { ViewMode } from '../types';

function getDecade(d: Date): string {
    const year = d.getFullYear();
    return year - (year % 10) + '';
}

function formatWeek(d: Date, ld: Date | null, lang: string): string {
    const endOfWeek = date_utils.add(d, 6, 'day');
    const endFormat = endOfWeek.getMonth() !== d.getMonth() ? 'D MMM' : 'D';
    const beginFormat = !ld || d.getMonth() !== ld.getMonth() ? 'D MMM' : 'D';
    return `${date_utils.format(d, beginFormat, lang)} - ${date_utils.format(endOfWeek, endFormat, lang)}`;
}

const DEFAULT_VIEW_MODES: ViewMode[] = [
    {
        name: 'Minute',
        padding: '1h',
        step: '1min',
        column_width: 20,
        date_format: 'YYYY-MM-DD HH:mm',
        lower_text: 'mm',
        upper_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getHours() !== ld.getHours()
                ? date_utils.format(d, 'D MMM HH:00', lang)
                : '',
        upper_text_frequency: 60,
    },
    {
        name: 'Quarter Hour',
        padding: '6h',
        step: '15min',
        column_width: 30,
        date_format: 'YYYY-MM-DD HH:mm',
        lower_text: 'mm',
        upper_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getHours() !== ld.getHours()
                ? date_utils.format(d, 'D MMM HH:00', lang)
                : '',
        upper_text_frequency: 4,
    },
    {
        name: 'Hour',
        padding: '7d',
        step: '1h',
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getDate() !== ld.getDate()
                ? date_utils.format(d, 'D MMMM', lang)
                : '',
        upper_text_frequency: 24,
    },
    {
        name: 'Quarter Day',
        padding: '7d',
        step: '6h',
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getDate() !== ld.getDate()
                ? date_utils.format(d, 'D MMM', lang)
                : '',
        upper_text_frequency: 4,
    },
    {
        name: 'Half Day',
        padding: '14d',
        step: '12h',
        date_format: 'YYYY-MM-DD HH:',
        lower_text: 'HH',
        upper_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getDate() !== ld.getDate()
                ? d.getMonth() !== ld?.getMonth()
                    ? date_utils.format(d, 'D MMM', lang)
                    : date_utils.format(d, 'D', lang)
                : '',
        upper_text_frequency: 2,
    },
    {
        name: 'Day',
        padding: '7d',
        date_format: 'YYYY-MM-DD',
        step: '1d',
        lower_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getDate() !== ld.getDate()
                ? date_utils.format(d, 'D', lang)
                : '',
        upper_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getMonth() !== ld.getMonth()
                ? date_utils.format(d, 'MMMM', lang)
                : '',
        thick_line: (d: Date) => d.getDay() === 1,
    },
    {
        name: 'Week',
        padding: '1m',
        step: '7d',
        date_format: 'YYYY-MM-DD',
        column_width: 140,
        lower_text: formatWeek,
        upper_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getMonth() !== ld.getMonth()
                ? date_utils.format(d, 'MMMM', lang)
                : '',
        thick_line: (d: Date) => d.getDate() >= 1 && d.getDate() <= 7,
        upper_text_frequency: 4,
    },
    {
        name: 'Month',
        padding: '2m',
        step: '1m',
        column_width: 120,
        date_format: 'YYYY-MM',
        lower_text: 'MMMM',
        upper_text: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getFullYear() !== ld.getFullYear()
                ? date_utils.format(d, 'YYYY', lang)
                : '',
        thick_line: (d: Date) => d.getMonth() % 3 === 0,
        snap_at: '7d',
    },
    {
        name: 'Year',
        padding: '2y',
        step: '1y',
        column_width: 120,
        date_format: 'YYYY',
        upper_text: (d: Date, ld: Date | null, _lang: string) =>
            !ld || getDecade(d) !== getDecade(ld) ? getDecade(d) : '',
        lower_text: 'YYYY',
        snap_at: '30d',
    },
];

export { DEFAULT_VIEW_MODES };
