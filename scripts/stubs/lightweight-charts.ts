// Audit-only stub: the real package is ESM-only and the audit never draws charts (it only runs the pages' data loading).
export const CandlestickSeries = {}, ColorType = {}, HistogramSeries = {}, LineSeries = {}, LineStyle = {};
export const createChart = () => ({}), createSeriesMarkers = () => ({});
export type IChartApi = object; export type ISeriesApi<T = unknown> = T extends never ? never : object; export type MouseEventParams = object; export type SeriesType = string;
