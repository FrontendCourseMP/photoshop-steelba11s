import {
  ApplyFilterOptions,
  EdgeHandling,
  FilterChannel,
  FilterMode,
  applyImageFilter,
} from "../core/imageFilters";

type FilterWorkerRequest = {
  requestId: number;
  sourceData: Uint8ClampedArray;
  width: number;
  height: number;
  kernel: number[];
  mode: FilterMode;
  channels: FilterChannel[];
  edgeHandling: EdgeHandling;
  normalizeKernelSum: boolean;
};

type FilterWorkerSuccess = {
  requestId: number;
  data: Uint8ClampedArray;
};

type FilterWorkerFailure = {
  requestId: number;
  error: string;
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<FilterWorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = async (
  event: MessageEvent<FilterWorkerRequest>
): Promise<void> => {
  const { requestId, ...options } = event.data;

  try {
    const data = await applyImageFilter({
      ...(options as ApplyFilterOptions),
      yieldEveryRows: 48,
    });
    const response: FilterWorkerSuccess = { requestId, data };
    workerScope.postMessage(response, [data.buffer as ArrayBuffer]);
  } catch (error) {
    const response: FilterWorkerFailure = {
      requestId,
      error: error instanceof Error ? error.message : "Не удалось применить фильтр",
    };
    workerScope.postMessage(response);
  }
};
