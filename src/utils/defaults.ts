import dateUtils from './dateUtils';
import type { ViewMode } from '../types';

function getDecade(d: Date): string {
    const year = d.getFullYear();
    return year - (year % 10) + '';
}

function formatWeek(d: Date, ld: Date | null, lang: string): string {
    const endOfWeek = dateUtils.add(d, 6, 'day');
    const endFormat = endOfWeek.getMonth() !== d.getMonth() ? 'D MMM' : 'D';
    const beginFormat = !ld || d.getMonth() !== ld.getMonth() ? 'D MMM' : 'D';
    return `${dateUtils.format(d, beginFormat, lang)} - ${dateUtils.format(endOfWeek, endFormat, lang)}`;
}

const DEFAULT_VIEW_MODES: ViewMode[] = [
    {
        name: 'Minute',
        padding: '1h',
        step: '1min',
        columnWidth: 20,
        dateFormat: 'YYYY-MM-DD HH:mm',
        lowerText: 'mm',
        upperText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getHours() !== ld.getHours()
                ? dateUtils.format(d, 'D MMM HH:00', lang)
                : '',
        upperTextFrequency: 60,
    },
    {
        name: 'Quarter Hour',
        padding: '6h',
        step: '15min',
        columnWidth: 30,
        dateFormat: 'YYYY-MM-DD HH:mm',
        lowerText: 'mm',
        upperText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getHours() !== ld.getHours()
                ? dateUtils.format(d, 'D MMM HH:00', lang)
                : '',
        upperTextFrequency: 4,
    },
    {
        name: 'Hour',
        padding: '7d',
        step: '1h',
        dateFormat: 'YYYY-MM-DD HH:',
        lowerText: 'HH',
        upperText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getDate() !== ld.getDate()
                ? dateUtils.format(d, 'D MMMM', lang)
                : '',
        upperTextFrequency: 24,
    },
    {
        name: 'Quarter Day',
        padding: '7d',
        step: '6h',
        dateFormat: 'YYYY-MM-DD HH:',
        lowerText: 'HH',
        upperText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getDate() !== ld.getDate()
                ? dateUtils.format(d, 'D MMM', lang)
                : '',
        upperTextFrequency: 4,
    },
    {
        name: 'Half Day',
        padding: '14d',
        step: '12h',
        dateFormat: 'YYYY-MM-DD HH:',
        lowerText: 'HH',
        upperText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getDate() !== ld.getDate()
                ? d.getMonth() !== ld?.getMonth()
                    ? dateUtils.format(d, 'D MMM', lang)
                    : dateUtils.format(d, 'D', lang)
                : '',
        upperTextFrequency: 2,
    },
    {
        name: 'Day',
        padding: '7d',
        dateFormat: 'YYYY-MM-DD',
        step: '1d',
        lowerText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getDate() !== ld.getDate()
                ? dateUtils.format(d, 'D', lang)
                : '',
        upperText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getMonth() !== ld.getMonth()
                ? dateUtils.format(d, 'MMMM', lang)
                : '',
        thickLine: (d: Date) => d.getDay() === 1,
    },
    {
        name: 'Week',
        padding: '1m',
        step: '7d',
        dateFormat: 'YYYY-MM-DD',
        columnWidth: 140,
        lowerText: formatWeek,
        upperText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getMonth() !== ld.getMonth()
                ? dateUtils.format(d, 'MMMM', lang)
                : '',
        thickLine: (d: Date) => d.getDate() >= 1 && d.getDate() <= 7,
        upperTextFrequency: 4,
    },
    {
        name: 'Month',
        padding: '2m',
        step: '1m',
        columnWidth: 120,
        dateFormat: 'YYYY-MM',
        lowerText: 'MMMM',
        upperText: (d: Date, ld: Date | null, lang: string) =>
            !ld || d.getFullYear() !== ld.getFullYear()
                ? dateUtils.format(d, 'YYYY', lang)
                : '',
        thickLine: (d: Date) => d.getMonth() % 3 === 0,
        snapAt: '7d',
    },
    {
        name: 'Year',
        padding: '2y',
        step: '1y',
        columnWidth: 120,
        dateFormat: 'YYYY',
        upperText: (d: Date, ld: Date | null, _lang: string) =>
            !ld || getDecade(d) !== getDecade(ld) ? getDecade(d) : '',
        lowerText: 'YYYY',
        snapAt: '30d',
    },
];

export { DEFAULT_VIEW_MODES };
