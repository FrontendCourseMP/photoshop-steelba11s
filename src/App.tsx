import { useMemo, useState, useEffect, useRef } from "react";
import "./App.css";
import { DecodedImage, decodeGB7 } from "./formats/gb7Decoder";
import { EncodedImage, encodeGB7 } from "./formats/gb7Encoder";
import { CANVAS_BG, CANVAS_HEIGHT, CANVAS_WIDTH } from "./core/constants";
import { LoadedImageInfo } from "./core/imageModel";
import { detectImageColorInfo } from "./core/colorDepth";
import {
  createCanvasFromImageData,
  resetCanvasBackground,
  setCanvasResolution,
} from "./canvas/canvasUtils";
import {
  applyChannelVisibility,
  ChannelMode,
  ChannelKey,
  ChannelVisibility,
  createChannelThumbnail,
  DEFAULT_CHANNEL_VISIBILITY,
} from "./canvas/channelPreview";
import { rgbToCielab } from "./core/cielab";
import {
  applyLevelsToData,
  buildHistogram,
  HistogramScale,
  LevelsSettings,
  LevelsTarget,
} from "./core/levels";
import {
  INTERPOLATION_ALGORITHMS,
  InterpolationMethod,
  resizeImageData,
  resizeImageDataRegion,
} from "./core/imageScale";

const DEFAULT_LEVELS_SETTINGS: LevelsSettings = {
  inputBlack: 0,
  inputWhite: 255,
  gamma: 1,
};

const MIN_VIEW_SCALE_PERCENT = 12;
const MAX_VIEW_SCALE_PERCENT = 300;
const INITIAL_VIEW_MARGIN = 50;
const DEFAULT_INTERPOLATION_METHOD: InterpolationMethod = "bilinear";
const MIN_RESIZE_PERCENT = 1;
const MAX_RESIZE_PERCENT = 1000;
const MIN_RESIZE_DIMENSION = 1;
const MAX_RESIZE_DIMENSION = 12000;
const MAX_RESIZE_PIXELS = 64_000_000;

type ResizeUnit = "percent" | "pixels";

type LevelsSettingsMap = Record<LevelsTarget, LevelsSettings>;

type CanvasImageLayout = {
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
};

type CanvasSize = {
  width: number;
  height: number;
};

const DEFAULT_CANVAS_SIZE: CanvasSize = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
};

const createDefaultLevelsSettingsMap = (): LevelsSettingsMap => ({
  master: { ...DEFAULT_LEVELS_SETTINGS },
  r: { ...DEFAULT_LEVELS_SETTINGS },
  g: { ...DEFAULT_LEVELS_SETTINGS },
  b: { ...DEFAULT_LEVELS_SETTINGS },
  a: { ...DEFAULT_LEVELS_SETTINGS },
  gray: { ...DEFAULT_LEVELS_SETTINGS },
});

const cloneLevelsSettingsMap = (source: LevelsSettingsMap): LevelsSettingsMap => ({
  master: { ...source.master },
  r: { ...source.r },
  g: { ...source.g },
  b: { ...source.b },
  a: { ...source.a },
  gray: { ...source.gray },
});

const clampViewScalePercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 100;
  }
  return Math.min(
    MAX_VIEW_SCALE_PERCENT,
    Math.max(MIN_VIEW_SCALE_PERCENT, Math.round(value))
  );
};

const calculateInitialViewScalePercent = (
  width: number,
  height: number,
  canvasSize: CanvasSize
): number => {
  if (width <= 0 || height <= 0) {
    return 100;
  }

  const availableWidth = Math.max(1, canvasSize.width - INITIAL_VIEW_MARGIN * 2);
  const availableHeight = Math.max(1, canvasSize.height - INITIAL_VIEW_MARGIN * 2);
  const fitPercent = Math.min(availableWidth / width, availableHeight / height) * 100;
  return clampViewScalePercent(fitPercent);
};

const getCanvasImageLayout = (
  imageWidth: number,
  imageHeight: number,
  scalePercent: number,
  canvasSize: CanvasSize
): CanvasImageLayout => {
  const ratio = clampViewScalePercent(scalePercent) / 100;
  const drawWidth = Math.max(1, Math.round(imageWidth * ratio));
  const drawHeight = Math.max(1, Math.round(imageHeight * ratio));

  return {
    drawWidth,
    drawHeight,
    offsetX: Math.round((canvasSize.width - drawWidth) / 2),
    offsetY: Math.round((canvasSize.height - drawHeight) / 2),
  };
};

const formatMegapixels = (pixels: number): string => {
  return `${(pixels / 1_000_000).toFixed(2)} Мп`;
};

const isDefaultLevelsSettings = (settings: LevelsSettings): boolean =>
  settings.inputBlack === DEFAULT_LEVELS_SETTINGS.inputBlack &&
  settings.inputWhite === DEFAULT_LEVELS_SETTINGS.inputWhite &&
  Math.abs(settings.gamma - DEFAULT_LEVELS_SETTINGS.gamma) < 0.0001;

const clampMidInputToRange = (midInput: number, black: number, white: number): number => {
  return Math.min(white - 1, Math.max(black + 1, midInput));
};

const gammaFromMidInput = (
  midInput: number,
  inputBlack: number,
  inputWhite: number
): number => {
  const range = Math.max(1, inputWhite - inputBlack);
  const normalizedMid =
    (clampMidInputToRange(midInput, inputBlack, inputWhite) - inputBlack) / range;
  const safeNormalizedMid = Math.min(0.9999, Math.max(0.0001, normalizedMid));
  return Math.min(9.99, Math.max(0.1, Math.log(0.5) / Math.log(safeNormalizedMid)));
};

const midInputFromGamma = (
  gamma: number,
  inputBlack: number,
  inputWhite: number
): number => {
  const safeGamma = Math.min(9.99, Math.max(0.1, gamma));
  const normalizedMid = Math.pow(0.5, 1 / safeGamma);
  const range = Math.max(1, inputWhite - inputBlack);
  return clampMidInputToRange(inputBlack + normalizedMid * range, inputBlack, inputWhite);
};

const relativeMidPositionFromGamma = (
  gamma: number,
  inputBlack: number,
  inputWhite: number
): number => {
  const range = Math.max(1, inputWhite - inputBlack);
  return (midInputFromGamma(gamma, inputBlack, inputWhite) - inputBlack) / range;
};

const midInputFromRelativePosition = (
  relativePosition: number,
  inputBlack: number,
  inputWhite: number
): number => {
  const range = Math.max(1, inputWhite - inputBlack);
  return clampMidInputToRange(
    inputBlack + relativePosition * range,
    inputBlack,
    inputWhite
  );
};

const normalizeLevelsSettings = (settings: LevelsSettings): LevelsSettings => {
  let inputBlack = Math.max(0, Math.min(253, Math.round(settings.inputBlack)));
  let inputWhite = Math.max(2, Math.min(255, Math.round(settings.inputWhite)));

  if (inputBlack > inputWhite - 2) {
    inputWhite = Math.min(255, inputBlack + 2);
  }
  if (inputBlack > inputWhite - 2) {
    inputBlack = Math.max(0, inputWhite - 2);
  }

  const gamma = Math.min(9.99, Math.max(0.1, settings.gamma));
  const midInput = midInputFromGamma(gamma, inputBlack, inputWhite);
  const safeGamma = gammaFromMidInput(midInput, inputBlack, inputWhite);

  return {
    inputBlack,
    inputWhite,
    gamma: safeGamma,
  };
};

function App() {
  type ToolKey = "none" | "eyedropper";
  type PickedPixel = {
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    l: number;
    labA: number;
    labB: number;
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const levelsDialogRef = useRef<HTMLDialogElement | null>(null);
  const levelsHistogramCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelsPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resizeDialogRef = useRef<HTMLDialogElement | null>(null);
  const autoFitViewRef = useRef(true);
  const [currentImage, setCurrentImage] = useState<EncodedImage | null>(null);
  const [pendingGb7Image, setPendingGb7Image] = useState<DecodedImage | null>(null);
  const [loadedImageInfo, setLoadedImageInfo] = useState<LoadedImageInfo | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(DEFAULT_CANVAS_SIZE);
  const [viewScalePercent, setViewScalePercent] = useState(100);
  const [hasAlphaChannel, setHasAlphaChannel] = useState(false);
  const [channelMode, setChannelMode] = useState<ChannelMode>("rgb");
  const [channelVisibility, setChannelVisibility] = useState<ChannelVisibility>(
    DEFAULT_CHANNEL_VISIBILITY
  );
  const [channelThumbnails, setChannelThumbnails] = useState<
    Partial<Record<ChannelKey, string>>
  >({});
  const [activeTool, setActiveTool] = useState<ToolKey>("none");
  const [pickedPixel, setPickedPixel] = useState<PickedPixel | null>(null);
  const [levelsTarget, setLevelsTarget] = useState<LevelsTarget>("master");
  const [histogramScale, setHistogramScale] = useState<HistogramScale>("linear");
  const [levelsSettingsByTarget, setLevelsSettingsByTarget] = useState<LevelsSettingsMap>(
    createDefaultLevelsSettingsMap
  );
  const [levelsPreviewEnabled, setLevelsPreviewEnabled] = useState(true);
  const [levelsDialogOpen, setLevelsDialogOpen] = useState(false);
  const [levelsBaseImage, setLevelsBaseImage] = useState<EncodedImage | null>(null);
  const [levelsInitialSettingsByTarget, setLevelsInitialSettingsByTarget] =
    useState<LevelsSettingsMap | null>(null);
  const [resizeUnit, setResizeUnit] = useState<ResizeUnit>("percent");
  const [resizeWidthValue, setResizeWidthValue] = useState(100);
  const [resizeHeightValue, setResizeHeightValue] = useState(100);
  const [resizeKeepAspect, setResizeKeepAspect] = useState(true);
  const [resizeInterpolation, setResizeInterpolation] = useState<InterpolationMethod>(
    DEFAULT_INTERPOLATION_METHOD
  );
  const [resizeValidationMessage, setResizeValidationMessage] = useState("");

  const hasTransparentPixels = (data: Uint8ClampedArray): boolean => {
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        return true;
      }
    }
    return false;
  };

  const resetChannelsForImage = (
    alphaAvailable: boolean,
    mode: ChannelMode
  ): void => {
    setHasAlphaChannel(alphaAvailable);
    setChannelMode(mode);
    setChannelVisibility({ ...DEFAULT_CHANNEL_VISIBILITY });
  };

  const clearLevelsDialogSession = (): void => {
    setLevelsDialogOpen(false);
    setLevelsPreviewEnabled(true);
    setLevelsBaseImage(null);
    setLevelsInitialSettingsByTarget(null);
    levelsDialogRef.current?.close();
  };

  useEffect(() => {
    const updateCanvasSize = (): void => {
      const container = canvasContainerRef.current;
      if (!container) {
        return;
      }

      const nextWidth = Math.max(1, Math.floor(container.clientWidth));
      const nextHeight = Math.max(1, Math.floor(container.clientHeight));

      setCanvasSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      );
    };

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);

    const container = canvasContainerRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateCanvasSize);

    if (container && resizeObserver) {
      resizeObserver.observe(container);
    }

    return () => {
      window.removeEventListener("resize", updateCanvasSize);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = setCanvasResolution(canvas, canvasSize.width, canvasSize.height);
    resetCanvasBackground(context, canvasSize.width, canvasSize.height, CANVAS_BG);
  }, [canvasSize]);

  useEffect(() => {
    if (!currentImage || !autoFitViewRef.current) {
      return;
    }

    setViewScalePercent(
      calculateInitialViewScalePercent(currentImage.width, currentImage.height, canvasSize)
    );
  }, [canvasSize, currentImage]);

  const resolveResizeTargetDimensions = (
    unit = resizeUnit,
    widthValue = resizeWidthValue,
    heightValue = resizeHeightValue
  ): { width: number; height: number } | null => {
    if (!currentImage) {
      return null;
    }

    if (unit === "percent") {
      return {
        width: Math.round((currentImage.width * widthValue) / 100),
        height: Math.round((currentImage.height * heightValue) / 100),
      };
    }

    return {
      width: Math.round(widthValue),
      height: Math.round(heightValue),
    };
  };

  const resizeTargetDimensions = useMemo(
    () => resolveResizeTargetDimensions(),
    [currentImage, resizeUnit, resizeWidthValue, resizeHeightValue]
  );

  const resizeValidation = useMemo((): string => {
    if (!currentImage || !resizeTargetDimensions) {
      return "Сначала загрузите изображение";
    }

    const valuesAreFinite =
      Number.isFinite(resizeWidthValue) && Number.isFinite(resizeHeightValue);
    if (!valuesAreFinite) {
      return "Введите числовые значения ширины и высоты";
    }

    if (resizeUnit === "percent") {
      if (
        resizeWidthValue < MIN_RESIZE_PERCENT ||
        resizeWidthValue > MAX_RESIZE_PERCENT ||
        resizeHeightValue < MIN_RESIZE_PERCENT ||
        resizeHeightValue > MAX_RESIZE_PERCENT
      ) {
        return `Проценты должны быть от ${MIN_RESIZE_PERCENT} до ${MAX_RESIZE_PERCENT}`;
      }
    } else if (
      resizeWidthValue < MIN_RESIZE_DIMENSION ||
      resizeWidthValue > MAX_RESIZE_DIMENSION ||
      resizeHeightValue < MIN_RESIZE_DIMENSION ||
      resizeHeightValue > MAX_RESIZE_DIMENSION
    ) {
      return `Размер в пикселях должен быть от ${MIN_RESIZE_DIMENSION} до ${MAX_RESIZE_DIMENSION}`;
    }

    if (
      resizeTargetDimensions.width < MIN_RESIZE_DIMENSION ||
      resizeTargetDimensions.height < MIN_RESIZE_DIMENSION
    ) {
      return "Итоговый размер должен быть не меньше 1 пикселя";
    }

    if (resizeTargetDimensions.width * resizeTargetDimensions.height > MAX_RESIZE_PIXELS) {
      return `Итоговое изображение не должно превышать ${formatMegapixels(MAX_RESIZE_PIXELS)}`;
    }

    return "";
  }, [
    currentImage,
    resizeHeightValue,
    resizeTargetDimensions,
    resizeUnit,
    resizeWidthValue,
  ]);

  const selectedResizeAlgorithm = INTERPOLATION_ALGORITHMS[resizeInterpolation];

  const visibleImageData = useMemo(() => {
    if (!currentImage) {
      return null;
    }

    return applyChannelVisibility(
      currentImage.data,
      channelVisibility,
      hasAlphaChannel,
      channelMode
    );
  }, [currentImage, channelVisibility, hasAlphaChannel, channelMode]);

  const availableLevelsTargets = useMemo((): LevelsTarget[] => {
    const base = channelMode === "gray" ? (["master", "gray"] as LevelsTarget[]) : (["master", "r", "g", "b"] as LevelsTarget[]);
    if (hasAlphaChannel) {
      base.push("a");
    }
    return base;
  }, [channelMode, hasAlphaChannel]);

  useEffect(() => {
    if (!availableLevelsTargets.includes(levelsTarget)) {
      setLevelsTarget("master");
    }
  }, [availableLevelsTargets, levelsTarget]);

  const activeLevelsSettings = levelsSettingsByTarget[levelsTarget];
  const levelsMidInput = useMemo(() => {
    return midInputFromGamma(
      activeLevelsSettings.gamma,
      activeLevelsSettings.inputBlack,
      activeLevelsSettings.inputWhite
    );
  }, [activeLevelsSettings]);

  const applyLevelsSettingsMapToData = (
    sourceData: Uint8ClampedArray,
    settingsMap: LevelsSettingsMap
  ): Uint8ClampedArray => {
    const targets =
      channelMode === "gray"
        ? (["master", "gray", "a"] as LevelsTarget[])
        : (["master", "r", "g", "b", "a"] as LevelsTarget[]);

    let result: Uint8ClampedArray = new Uint8ClampedArray(sourceData);
    targets.forEach((target) => {
      if (target === "a" && !hasAlphaChannel) {
        return;
      }
      const settings = settingsMap[target];
      if (isDefaultLevelsSettings(settings)) {
        return;
      }
      result = applyLevelsToData(result, target, settings, hasAlphaChannel);
    });

    return result;
  };

  const levelsPreviewData = useMemo(() => {
    if (!levelsDialogOpen || !levelsBaseImage) {
      return null;
    }
    if (!levelsPreviewEnabled) {
      return new Uint8ClampedArray(levelsBaseImage.data);
    }
    return applyLevelsSettingsMapToData(levelsBaseImage.data, levelsSettingsByTarget);
  }, [
    levelsDialogOpen,
    levelsBaseImage,
    levelsPreviewEnabled,
    levelsSettingsByTarget,
    channelMode,
    hasAlphaChannel,
  ]);

  const levelsHistogram = useMemo(() => {
    const histogramSource =
      levelsDialogOpen && levelsBaseImage ? levelsBaseImage : currentImage;
    if (!histogramSource) {
      return null;
    }
    return buildHistogram(histogramSource.data, levelsTarget, {
      masterMode: channelMode === "gray" ? "gray" : "luminance",
    });
  }, [currentImage, levelsTarget, levelsDialogOpen, levelsBaseImage, channelMode]);

  useEffect(() => {
    const canvas = levelsHistogramCanvasRef.current;
    if (!canvas || !levelsHistogram) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#1a1a1a";
    context.fillRect(0, 0, width, height);

    const maxCount = levelsHistogram.reduce((max, value) => Math.max(max, value), 0);
    if (maxCount <= 0) {
      return;
    }

    const histogramValues =
      histogramScale === "log"
        ? Array.from(levelsHistogram, (value) => Math.log1p(value))
        : Array.from(levelsHistogram);
    const maxDisplayValue = histogramValues.reduce(
      (max, value) => Math.max(max, value),
      0
    );
    if (maxDisplayValue <= 0) {
      return;
    }

    const barWidth = width / 256;
    context.fillStyle = "#b8b8b8";
    for (let i = 0; i < 256; i += 1) {
      const normalized = histogramValues[i] / maxDisplayValue;
      const barHeight = Math.max(1, Math.round(normalized * (height - 2)));
      const x = i * barWidth;
      const y = height - barHeight;
      context.fillRect(x, y, Math.ceil(barWidth), barHeight);
    }
  }, [levelsHistogram, histogramScale]);

  useEffect(() => {
    const canvas = levelsPreviewCanvasRef.current;
    if (!canvas || !levelsBaseImage || !levelsPreviewData) {
      return;
    }

    const context = setCanvasResolution(canvas, canvas.width, canvas.height);
    if (!context) {
      return;
    }

    resetCanvasBackground(context, canvas.width, canvas.height, "#1a1a1a");

    const ratio = Math.min(
      canvas.width / levelsBaseImage.width,
      canvas.height / levelsBaseImage.height
    );
    const drawWidth = Math.max(1, Math.round(levelsBaseImage.width * ratio));
    const drawHeight = Math.max(1, Math.round(levelsBaseImage.height * ratio));
    const offsetX = Math.round((canvas.width - drawWidth) / 2);
    const offsetY = Math.round((canvas.height - drawHeight) / 2);
    const resizedPreviewData = resizeImageData(
      levelsPreviewData,
      levelsBaseImage.width,
      levelsBaseImage.height,
      drawWidth,
      drawHeight,
      DEFAULT_INTERPOLATION_METHOD
    );

    context.putImageData(
      new ImageData(new Uint8ClampedArray(resizedPreviewData), drawWidth, drawHeight),
      offsetX,
      offsetY
    );
  }, [levelsBaseImage, levelsPreviewData]);

  useEffect(() => {
    if (!currentImage) {
      setChannelThumbnails({});
      return;
    }

    const thumbnails: Partial<Record<ChannelKey, string>> = {};
    const baseChannels: ChannelKey[] =
      channelMode === "gray" ? ["gray"] : ["r", "g", "b"];

    baseChannels.forEach((channel) => {
      const thumb = createChannelThumbnail(
        currentImage.data,
        currentImage.width,
        currentImage.height,
        channel
      );
      if (thumb) {
        thumbnails[channel] = thumb;
      }
    });

    if (hasAlphaChannel) {
      const alphaThumb = createChannelThumbnail(
        currentImage.data,
        currentImage.width,
        currentImage.height,
        "a"
      );
      if (alphaThumb) {
        thumbnails.a = alphaThumb;
      }
    }

    setChannelThumbnails(thumbnails);
  }, [currentImage, hasAlphaChannel, channelMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentImage) {
      return;
    }

    const visibleData = visibleImageData;
    if (!visibleData) {
      return;
    }

    const context = setCanvasResolution(canvas, canvasSize.width, canvasSize.height);
    if (!context) {
      return;
    }

    resetCanvasBackground(context, canvasSize.width, canvasSize.height, CANVAS_BG);

    const layout = getCanvasImageLayout(
      currentImage.width,
      currentImage.height,
      viewScalePercent,
      canvasSize
    );
    const regionX = Math.max(0, -layout.offsetX);
    const regionY = Math.max(0, -layout.offsetY);
    const destinationX = Math.max(0, layout.offsetX);
    const destinationY = Math.max(0, layout.offsetY);
    const regionWidth = Math.min(
      layout.drawWidth - regionX,
      canvasSize.width - destinationX
    );
    const regionHeight = Math.min(
      layout.drawHeight - regionY,
      canvasSize.height - destinationY
    );

    if (regionWidth <= 0 || regionHeight <= 0) {
      return;
    }

    const scaledData = resizeImageDataRegion(
      visibleData,
      currentImage.width,
      currentImage.height,
      layout.drawWidth,
      layout.drawHeight,
      regionX,
      regionY,
      regionWidth,
      regionHeight,
      DEFAULT_INTERPOLATION_METHOD
    );

    context.putImageData(
      new ImageData(new Uint8ClampedArray(scaledData), regionWidth, regionHeight),
      destinationX,
      destinationY
    );
  }, [canvasSize, currentImage, visibleImageData, viewScalePercent]);

  const handleUpload = (): void => {
    fileInputRef.current?.click();
  };

  const loadGb7AsNative = (decoded: DecodedImage): void => {
    clearLevelsDialogSession();
    resetChannelsForImage(decoded.hasMask, "gray");
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");

    setCurrentImage({
      width: decoded.width,
      height: decoded.height,
      data: new Uint8ClampedArray(decoded.data),
      hasMask: decoded.hasMask,
    });
    setLoadedImageInfo({
      width: decoded.width,
      height: decoded.height,
      colorDepthBits: decoded.colorDepth,
    });
    autoFitViewRef.current = true;
    setViewScalePercent(
      calculateInitialViewScalePercent(decoded.width, decoded.height, canvasSize)
    );
    setPickedPixel(null);
  };

  const loadGb7AsRgba = (decoded: DecodedImage): void => {
    clearLevelsDialogSession();
    resetChannelsForImage(decoded.hasMask, "rgb");
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");

    setCurrentImage({
      width: decoded.width,
      height: decoded.height,
      data: new Uint8ClampedArray(decoded.data),
      hasMask: decoded.hasMask,
    });
    setLoadedImageInfo({
      width: decoded.width,
      height: decoded.height,
      colorDepthBits: decoded.hasMask ? 32 : 24,
    });
    autoFitViewRef.current = true;
    setViewScalePercent(
      calculateInitialViewScalePercent(decoded.width, decoded.height, canvasSize)
    );
    setPickedPixel(null);
  };

  const gb7ImportDialogRef = useRef<HTMLDialogElement | null>(null);

  const closeGb7ImportDialog = (): void => {
    gb7ImportDialogRef.current?.close();
    setPendingGb7Image(null);
  };

  const handleKeepGb7 = (): void => {
    if (!pendingGb7Image) {
      return;
    }

    loadGb7AsNative(pendingGb7Image);
    closeGb7ImportDialog();
  };

  const handleConvertGb7ToRgba = (): void => {
    if (!pendingGb7Image) {
      return;
    }

    loadGb7AsRgba(pendingGb7Image);
    closeGb7ImportDialog();
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".gb7")) {
      try {
        const buffer = await file.arrayBuffer();
        const decoded = decodeGB7(buffer);
        setPendingGb7Image(decoded);
        gb7ImportDialogRef.current?.showModal();
      } catch (error) {
        alert(error instanceof Error ? error.message : "Не удалось загрузить GB7");
      }
      event.target.value = "";

      return;
    }

    if (
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg")
    ) {
      const detectedColorInfo = await detectImageColorInfo(file, fileName);
      const imageUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = (): void => {
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = image.width;
        sourceCanvas.height = image.height;
        const sourceContext = sourceCanvas.getContext("2d");
        if (!sourceContext) {
          URL.revokeObjectURL(imageUrl);
          return;
        }

        sourceContext.clearRect(0, 0, image.width, image.height);
        sourceContext.drawImage(image, 0, 0);

        const originalData = sourceContext.getImageData(
          0,
          0,
          image.width,
          image.height
        );
        const alphaInPixels = hasTransparentPixels(originalData.data);
        const effectiveHasAlpha =
          detectedColorInfo.hasAlphaChannel || alphaInPixels;
        const effectiveColorDepth = effectiveHasAlpha
          ? Math.max(detectedColorInfo.colorDepthBits, 32)
          : detectedColorInfo.colorDepthBits;

        resetChannelsForImage(effectiveHasAlpha, "rgb");
        clearLevelsDialogSession();
        setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
        setLevelsTarget("master");

        setLoadedImageInfo({
          width: image.width,
          height: image.height,
          colorDepthBits: effectiveColorDepth,
        });
        setCurrentImage({
          width: image.width,
          height: image.height,
          data: originalData.data,
          hasMask: effectiveHasAlpha,
        });
        autoFitViewRef.current = true;
        setViewScalePercent(
          calculateInitialViewScalePercent(image.width, image.height, canvasSize)
        );
        setPickedPixel(null);

        URL.revokeObjectURL(imageUrl);
      };

      image.onerror = (): void => {
        URL.revokeObjectURL(imageUrl);
        alert("Не удалось загрузить изображение");
      };

      image.src = imageUrl;
      event.target.value = "";

      return;
    }

    alert("Неподдерживаемый формат файла");
    event.target.value = "";
  };

  const saveImage = (): void => {
    if (!currentImage) {
      return;
    }

    const exportCanvas = createCanvasFromImageData(
      currentImage.width,
      currentImage.height,
      currentImage.data
    );
    if (!exportCanvas) {
      return;
    }

    const link = document.createElement("a");
    link.download = "edited_image.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  };

  const handleDownloadJPG = (): void => {
    if (!currentImage) {
      return;
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = currentImage.width;
    exportCanvas.height = currentImage.height;
    const exportContext = exportCanvas.getContext("2d");
    if (!exportContext) {
      return;
    }

    exportContext.fillStyle = "#ffffff";
    exportContext.fillRect(0, 0, currentImage.width, currentImage.height);

    const sourceCanvas = createCanvasFromImageData(
      currentImage.width,
      currentImage.height,
      currentImage.data
    );
    if (!sourceCanvas) {
      return;
    }

    exportContext.drawImage(sourceCanvas, 0, 0);

    const link = document.createElement("a");
    link.download = "image.jpg";
    link.href = exportCanvas.toDataURL("image/jpeg", 0.92);
    link.click();
  };

  const handleDownloadGB7 = (): void => {
    if (!currentImage) {
      alert("Сначала загрузите изображение");
      return;
    }

    let buffer: ArrayBuffer;
    try {
      buffer = encodeGB7(currentImage);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сохранить GB7");
      return;
    }

    const blob = new Blob([buffer], {
      type: "application/octet-stream",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "image.gb7";
    link.click();

    const decoded = decodeGB7(buffer);
    clearLevelsDialogSession();
    resetChannelsForImage(decoded.hasMask, "gray");
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");

    setCurrentImage({
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
      hasMask: decoded.hasMask,
    });
    setLoadedImageInfo({
      width: decoded.width,
      height: decoded.height,
      colorDepthBits: decoded.colorDepth,
    });
    autoFitViewRef.current = true;
    setViewScalePercent(
      calculateInitialViewScalePercent(decoded.width, decoded.height, canvasSize)
    );
    setPickedPixel(null);
    URL.revokeObjectURL(url);
  };

  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const openDialog = (): void => {
    if (!currentImage) {
      alert("Сначала загрузите изображение");
      return;
    }

    dialogRef.current?.showModal();
  };

  const closeDialog = (): void => {
    dialogRef.current?.close();
  };

  const handleDialogClick = (event: React.MouseEvent<HTMLDialogElement>): void => {
    if (event.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  };

  const handleViewScaleChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    autoFitViewRef.current = false;
    setViewScalePercent(clampViewScalePercent(value));
  };

  const openResizeDialog = (): void => {
    if (!currentImage) {
      alert("Сначала загрузите изображение");
      return;
    }

    setResizeUnit("percent");
    setResizeWidthValue(100);
    setResizeHeightValue(100);
    setResizeKeepAspect(true);
    setResizeInterpolation(DEFAULT_INTERPOLATION_METHOD);
    setResizeValidationMessage("");
    resizeDialogRef.current?.showModal();
  };

  const closeResizeDialog = (): void => {
    setResizeValidationMessage("");
    resizeDialogRef.current?.close();
  };

  const handleResizeDialogClick = (event: React.MouseEvent<HTMLDialogElement>): void => {
    if (event.target === resizeDialogRef.current) {
      closeResizeDialog();
    }
  };

  const syncResizeHeightToWidth = (
    widthValue: number,
    unit = resizeUnit
  ): number => {
    if (!currentImage) {
      return widthValue;
    }
    if (unit === "percent") {
      return widthValue;
    }
    return Math.max(
      MIN_RESIZE_DIMENSION,
      Math.round(widthValue * (currentImage.height / currentImage.width))
    );
  };

  const syncResizeWidthToHeight = (
    heightValue: number,
    unit = resizeUnit
  ): number => {
    if (!currentImage) {
      return heightValue;
    }
    if (unit === "percent") {
      return heightValue;
    }
    return Math.max(
      MIN_RESIZE_DIMENSION,
      Math.round(heightValue * (currentImage.width / currentImage.height))
    );
  };

  const handleResizeUnitChange = (unit: ResizeUnit): void => {
    const currentTarget = resolveResizeTargetDimensions();

    setResizeUnit(unit);
    setResizeValidationMessage("");

    if (!currentImage || !currentTarget) {
      return;
    }

    if (unit === "percent") {
      const widthPercent = (currentTarget.width / currentImage.width) * 100;
      const heightPercent = (currentTarget.height / currentImage.height) * 100;
      setResizeWidthValue(Math.round(widthPercent * 100) / 100);
      setResizeHeightValue(
        resizeKeepAspect
          ? Math.round(widthPercent * 100) / 100
          : Math.round(heightPercent * 100) / 100
      );
      return;
    }

    setResizeWidthValue(currentTarget.width);
    setResizeHeightValue(
      resizeKeepAspect
        ? syncResizeHeightToWidth(currentTarget.width, unit)
        : currentTarget.height
    );
  };

  const handleResizeWidthChange = (value: number): void => {
    const nextValue = Number.isFinite(value) ? value : 0;
    setResizeWidthValue(nextValue);
    if (resizeKeepAspect) {
      setResizeHeightValue(syncResizeHeightToWidth(nextValue));
    }
    setResizeValidationMessage("");
  };

  const handleResizeHeightChange = (value: number): void => {
    const nextValue = Number.isFinite(value) ? value : 0;
    setResizeHeightValue(nextValue);
    if (resizeKeepAspect) {
      setResizeWidthValue(syncResizeWidthToHeight(nextValue));
    }
    setResizeValidationMessage("");
  };

  const handleResizeKeepAspectChange = (checked: boolean): void => {
    setResizeKeepAspect(checked);
    if (checked) {
      setResizeHeightValue(syncResizeHeightToWidth(resizeWidthValue));
    }
    setResizeValidationMessage("");
  };

  const handleApplyResize = (): void => {
    if (!currentImage || !resizeTargetDimensions) {
      return;
    }
    if (resizeValidation) {
      setResizeValidationMessage(resizeValidation);
      return;
    }

    const nextData = resizeImageData(
      currentImage.data,
      currentImage.width,
      currentImage.height,
      resizeTargetDimensions.width,
      resizeTargetDimensions.height,
      resizeInterpolation
    );

    clearLevelsDialogSession();
    setCurrentImage({
      ...currentImage,
      width: resizeTargetDimensions.width,
      height: resizeTargetDimensions.height,
      data: nextData,
    });
    setLoadedImageInfo((prev) =>
      prev
        ? {
            ...prev,
            width: resizeTargetDimensions.width,
            height: resizeTargetDimensions.height,
          }
        : prev
    );
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");
    setPickedPixel(null);
    setResizeValidationMessage("");
    resizeDialogRef.current?.close();
  };

  const openLevelsDialog = (): void => {
    if (!currentImage) {
      alert("Сначала загрузите изображение");
      return;
    }
    setLevelsBaseImage({
      width: currentImage.width,
      height: currentImage.height,
      hasMask: currentImage.hasMask,
      data: new Uint8ClampedArray(currentImage.data),
    });
    setLevelsInitialSettingsByTarget(cloneLevelsSettingsMap(levelsSettingsByTarget));
    setLevelsPreviewEnabled(true);
    setLevelsDialogOpen(true);
    levelsDialogRef.current?.showModal();
  };

  const closeLevelsDialog = (): void => {
    clearLevelsDialogSession();
  };

  const handleLevelsDialogClick = (
    event: React.MouseEvent<HTMLDialogElement>
  ): void => {
    if (event.target === levelsDialogRef.current) {
      handleCancelLevels();
    }
  };

  const updateActiveLevelsSettings = (
    updater: (settings: LevelsSettings) => LevelsSettings
  ): void => {
    setLevelsSettingsByTarget((prev) => ({
      ...prev,
      [levelsTarget]: normalizeLevelsSettings(updater(prev[levelsTarget])),
    }));
  };

  const handleLevelsBlackChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateActiveLevelsSettings((prev) => {
      const inputWhite = prev.inputWhite;
      const inputBlack = Math.min(inputWhite - 2, Math.max(0, Math.round(value)));
      const relativeMid = relativeMidPositionFromGamma(
        prev.gamma,
        prev.inputBlack,
        prev.inputWhite
      );
      const midInput = midInputFromRelativePosition(
        relativeMid,
        inputBlack,
        inputWhite
      );
      const gamma = gammaFromMidInput(midInput, inputBlack, inputWhite);
      return { inputBlack, inputWhite, gamma };
    });
  };

  const handleLevelsWhiteChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateActiveLevelsSettings((prev) => {
      const inputBlack = prev.inputBlack;
      const inputWhite = Math.max(inputBlack + 2, Math.min(255, Math.round(value)));
      const relativeMid = relativeMidPositionFromGamma(
        prev.gamma,
        prev.inputBlack,
        prev.inputWhite
      );
      const midInput = midInputFromRelativePosition(
        relativeMid,
        inputBlack,
        inputWhite
      );
      const gamma = gammaFromMidInput(midInput, inputBlack, inputWhite);
      return { inputBlack, inputWhite, gamma };
    });
  };

  const handleLevelsGammaChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateActiveLevelsSettings((prev) => ({ ...prev, gamma: value }));
  };

  const handleLevelsMidInputChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateActiveLevelsSettings((prev) => {
      const midInput = clampMidInputToRange(
        value,
        prev.inputBlack,
        prev.inputWhite
      );
      const gamma = gammaFromMidInput(midInput, prev.inputBlack, prev.inputWhite);
      return {
        ...prev,
        gamma,
      };
    });
  };

  const handleApplyLevels = (): void => {
    if (!levelsBaseImage || !currentImage) {
      return;
    }
    const nextData = applyLevelsSettingsMapToData(
      levelsBaseImage.data,
      levelsSettingsByTarget
    );
    setCurrentImage({
      ...currentImage,
      data: nextData,
    });
    setPickedPixel(null);
    closeLevelsDialog();
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");
  };

  const handleResetLevels = (): void => {
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
  };

  const handleCancelLevels = (): void => {
    if (levelsBaseImage && currentImage) {
      setCurrentImage({
        ...currentImage,
        width: levelsBaseImage.width,
        height: levelsBaseImage.height,
        hasMask: levelsBaseImage.hasMask,
        data: new Uint8ClampedArray(levelsBaseImage.data),
      });
    }

    if (levelsInitialSettingsByTarget) {
      setLevelsSettingsByTarget(cloneLevelsSettingsMap(levelsInitialSettingsByTarget));
    }
    setPickedPixel(null);
    closeLevelsDialog();
  };

  const toggleChannelVisibility = (channel: ChannelKey): void => {
    if (channel === "a" && !hasAlphaChannel) {
      return;
    }
    if (
      (channelMode === "gray" && (channel === "r" || channel === "g" || channel === "b")) ||
      (channelMode === "rgb" && channel === "gray")
    ) {
      return;
    }

    setChannelVisibility((prev) => ({
      ...prev,
      [channel]: !prev[channel],
    }));
  };


  // ----- Пипетка -----
  const getImagePointFromCanvasClick = (
    event: React.MouseEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || !currentImage) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const canvasX = (event.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (event.clientY - rect.top) * (canvas.height / rect.height);

    const layout = getCanvasImageLayout(
      currentImage.width,
      currentImage.height,
      viewScalePercent,
      { width: canvas.width, height: canvas.height }
    );

    if (
      canvasX < layout.offsetX ||
      canvasY < layout.offsetY ||
      canvasX >= layout.offsetX + layout.drawWidth ||
      canvasY >= layout.offsetY + layout.drawHeight
    ) {
      return null;
    }

    const x = Math.floor(
      ((canvasX - layout.offsetX) * currentImage.width) / layout.drawWidth
    );
    const y = Math.floor(
      ((canvasY - layout.offsetY) * currentImage.height) / layout.drawHeight
    );

    if (x < 0 || y < 0 || x >= currentImage.width || y >= currentImage.height) {
      return null;
    }

    return { x, y };
  };

  const handleCanvasMouseDown = (
    event: React.MouseEvent<HTMLCanvasElement>
  ): void => {
    if (activeTool !== "eyedropper" || event.button !== 0 || !currentImage || !visibleImageData) {
      return;
    }

    const point = getImagePointFromCanvasClick(event);
    if (!point) {
      return;
    }

    const pixelIndex = (point.y * currentImage.width + point.x) * 4;
    const visibleAlpha = currentImage.data[pixelIndex + 3];
    if (visibleAlpha === 0) {
      setPickedPixel(null);
      return;
    }

    const r = currentImage.data[pixelIndex];
    const g = currentImage.data[pixelIndex + 1];
    const b = currentImage.data[pixelIndex + 2];
    const lab = rgbToCielab(r, g, b);

    setPickedPixel({
      x: point.x,
      y: point.y,
      r,
      g,
      b,
      l: lab.l,
      labA: lab.a,
      labB: lab.b,
    });
  };

  const getLevelsTargetLabel = (target: LevelsTarget): string => {
    if (target === "master") {
      return "Master";
    }
    if (target === "r") {
      return "Red";
    }
    if (target === "g") {
      return "Green";
    }
    if (target === "b") {
      return "Blue";
    }
    if (target === "a") {
      return "Alpha";
    }
    return "Gray";
  };

  const resizeBeforePixels = currentImage ? currentImage.width * currentImage.height : 0;
  const resizeAfterPixels =
    resizeTargetDimensions &&
    Number.isFinite(resizeTargetDimensions.width) &&
    Number.isFinite(resizeTargetDimensions.height)
      ? Math.max(0, resizeTargetDimensions.width * resizeTargetDimensions.height)
      : 0;
  const resizeInputMin =
    resizeUnit === "percent" ? MIN_RESIZE_PERCENT : MIN_RESIZE_DIMENSION;
  const resizeInputMax =
    resizeUnit === "percent" ? MAX_RESIZE_PERCENT : MAX_RESIZE_DIMENSION;
  const resizeInputStep = resizeUnit === "percent" ? 0.1 : 1;
  const resizeUnitSuffix = resizeUnit === "percent" ? "%" : "px";
  const resizeStatusMessage = resizeValidationMessage || resizeValidation;
  const resizeTooltip = `${selectedResizeAlgorithm.description} ${selectedResizeAlgorithm.advantage}`;

  return (
    <div className="App">
      <main className="App-main">
        <header className="Top-toolbar">
          <nav className="Upload-menu">
            <ul>
              <li>
                <details open>
                  <summary>Файл</summary>

                  <div className="Column">
                    <input
                      ref={fileInputRef}
                      className="HiddenInput"
                      type="file"
                      accept=".gb7,image/png,image/jpeg"
                      onChange={handleFileUpload}
                    />

                    <button
                      className="Nav-buttons"
                      type="button"
                      onClick={handleUpload}
                    >
                      Загрузить изображение
                    </button>

                    <button
                      className="Nav-buttons"
                      type="button"
                      onClick={openDialog}
                    >
                      Экспортировать как...
                    </button>
                  </div>
                </details>
              </li>
            </ul>
          </nav>

          <section className="Quick-tools">
            <button
              type="button"
              className={`Quick-tool ${activeTool === "eyedropper" ? "tool-active" : ""}`}
              onClick={() =>
                setActiveTool((prev) => (prev === "eyedropper" ? "none" : "eyedropper"))
              }
            >
              {"\u041f\u0438\u043f\u0435\u0442\u043a\u0430"}
            </button>
            <button type="button" className="Quick-tool" onClick={openLevelsDialog}>
              {"\u0423\u0440\u043e\u0432\u043d\u0438"}
            </button>
            <button type="button" className="Quick-tool" onClick={openResizeDialog}>
              {"\u041c\u0430\u0441\u0448\u0442\u0430\u0431"}
            </button>
          </section>
        </header>

          <dialog
            ref={dialogRef}
            className="Export-dialog"
            onClick={handleDialogClick}
          >
            <p>В каком формате сохранить изображение?</p>
            <button
              className="Nav-buttons"
              type="button"
              onClick={saveImage}
            >
              PNG
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={handleDownloadGB7}
            >
              GB7
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={handleDownloadJPG}
            >
              JPG
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={closeDialog}
            >
              Закрыть
            </button>
          </dialog>
          <dialog
            ref={gb7ImportDialogRef}
            className="Import-dialog"
            onClick={(event) => {
              if (event.target === gb7ImportDialogRef.current) {
                closeGb7ImportDialog();
              }
            }}
          >
            <p>Как загрузить GB7?</p>
            <button
              className="Nav-buttons"
              type="button"
              onClick={handleConvertGb7ToRgba}
            >
              Конвертировать в RGBA
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={handleKeepGb7}
            >
              Оставить GB7
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={closeGb7ImportDialog}
            >
              Отмена
            </button>
          </dialog>
          <dialog
            ref={levelsDialogRef}
            className="Levels-dialog"
            onClick={handleLevelsDialogClick}
            onCancel={(event) => {
              event.preventDefault();
              handleCancelLevels();
            }}
          >
            <div className="Levels-header">
              <h3>Уровни</h3>
              <button
                className="Nav-buttons Levels-close"
                type="button"
                onClick={handleCancelLevels}
              >
                X
              </button>
            </div>

            <div className="Levels-layout">
              <div className="Levels-controls-column">
                <div className="Levels-controls-row">
                  <label>
                    Канал
                    <select
                      value={levelsTarget}
                      onChange={(event) =>
                        setLevelsTarget(event.target.value as LevelsTarget)
                      }
                    >
                      {availableLevelsTargets.map((target) => (
                        <option key={target} value={target}>
                          {getLevelsTargetLabel(target)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Масштаб
                    <select
                      value={histogramScale}
                      onChange={(event) =>
                        setHistogramScale(event.target.value as HistogramScale)
                      }
                    >
                      <option value="linear">Линейный</option>
                      <option value="log">Логарифмический</option>
                    </select>
                  </label>
                </div>

                <div className="Levels-histogram">
                  <canvas
                    ref={levelsHistogramCanvasRef}
                    width={512}
                    height={180}
                    aria-label="Гистограмма уровней"
                  />
                </div>

                <div className="Levels-input-markers">
                  <div className="Levels-markers-axis" />
                  <input
                    className="Levels-marker Levels-marker-black"
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={activeLevelsSettings.inputBlack}
                    onChange={(event) =>
                      handleLevelsBlackChange(event.target.valueAsNumber)
                    }
                    aria-label="Black input marker"
                  />
                  <input
                    className="Levels-marker Levels-marker-gamma"
                    type="range"
                    min={0}
                    max={255}
                    step="any"
                    value={levelsMidInput}
                    onChange={(event) =>
                      handleLevelsMidInputChange(event.target.valueAsNumber)
                    }
                    aria-label="Gamma input marker"
                  />
                  <input
                    className="Levels-marker Levels-marker-white"
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={activeLevelsSettings.inputWhite}
                    onChange={(event) =>
                      handleLevelsWhiteChange(event.target.valueAsNumber)
                    }
                    aria-label="White input marker"
                  />
                  <div className="Levels-input-markers-scale">
                    <span>0</span>
                    <span>255</span>
                  </div>
                </div>

                <div className="Levels-values-row">
                  <label>
                    Black
                    <input
                      type="number"
                      min={0}
                      max={activeLevelsSettings.inputWhite - 2}
                      step={1}
                      value={activeLevelsSettings.inputBlack}
                      onChange={(event) =>
                        handleLevelsBlackChange(event.target.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    Gamma
                    <input
                      type="number"
                      min={0.1}
                      max={9.99}
                      step={0.01}
                      value={Number(activeLevelsSettings.gamma.toFixed(2))}
                      onChange={(event) =>
                        handleLevelsGammaChange(event.target.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    White
                    <input
                      type="number"
                      min={activeLevelsSettings.inputBlack + 2}
                      max={255}
                      step={1}
                      value={activeLevelsSettings.inputWhite}
                      onChange={(event) =>
                        handleLevelsWhiteChange(event.target.valueAsNumber)
                      }
                    />
                  </label>
                </div>

                <div className="Levels-actions">
                  <button className="Nav-buttons" type="button" onClick={handleApplyLevels}>
                    Применить
                  </button>
                  <button
                    className="Nav-buttons"
                    type="button"
                    onClick={handleResetLevels}
                  >
                    Сброс
                  </button>
                  <button className="Nav-buttons" type="button" onClick={handleCancelLevels}>
                    Отмена
                  </button>
                </div>
              </div>

              <div className="Levels-preview-column">
                <label className="Levels-preview-toggle">
                  <input
                    type="checkbox"
                    checked={levelsPreviewEnabled}
                    onChange={(event) => setLevelsPreviewEnabled(event.target.checked)}
                  />
                  Предпросмотр
                </label>

                <div className="Levels-preview-mini">
                  <canvas
                    ref={levelsPreviewCanvasRef}
                    width={320}
                    height={180}
                    aria-label="Миниатюра предпросмотра уровней"
                  />
                </div>
              </div>
            </div>
          </dialog>
          <dialog
            ref={resizeDialogRef}
            className="Resize-dialog"
            onClick={handleResizeDialogClick}
            onCancel={(event) => {
              event.preventDefault();
              closeResizeDialog();
            }}
          >
            <div className="Resize-header">
              <h3>Изменение масштаба</h3>
              <button
                className="Nav-buttons Resize-close"
                type="button"
                onClick={closeResizeDialog}
              >
                X
              </button>
            </div>

            <div className="Resize-pixels-row">
              <span>До: {formatMegapixels(resizeBeforePixels)}</span>
              <span>После: {formatMegapixels(resizeAfterPixels)}</span>
            </div>

            <div className="Resize-form-grid">
              <label>
                Единицы
                <select
                  value={resizeUnit}
                  onChange={(event) =>
                    handleResizeUnitChange(event.target.value as ResizeUnit)
                  }
                >
                  <option value="percent">Проценты</option>
                  <option value="pixels">Пиксели</option>
                </select>
              </label>

              <label>
                Интерполяция
                <div className="Resize-interpolation-row">
                  <select
                    value={resizeInterpolation}
                    onChange={(event) =>
                      setResizeInterpolation(event.target.value as InterpolationMethod)
                    }
                  >
                    {Object.entries(INTERPOLATION_ALGORITHMS).map(
                      ([method, algorithm]) => (
                        <option key={method} value={method}>
                          {algorithm.label}
                        </option>
                      )
                    )}
                  </select>
                  <span
                    className="Resize-tooltip"
                    tabIndex={0}
                    title={resizeTooltip}
                    aria-label={resizeTooltip}
                  >
                    ?
                  </span>
                </div>
              </label>

              <label>
                Ширина, {resizeUnitSuffix}
                <input
                  type="number"
                  min={resizeInputMin}
                  max={resizeInputMax}
                  step={resizeInputStep}
                  value={resizeWidthValue}
                  onChange={(event) =>
                    handleResizeWidthChange(event.target.valueAsNumber)
                  }
                />
              </label>

              <label>
                Высота, {resizeUnitSuffix}
                <input
                  type="number"
                  min={resizeInputMin}
                  max={resizeInputMax}
                  step={resizeInputStep}
                  value={resizeHeightValue}
                  onChange={(event) =>
                    handleResizeHeightChange(event.target.valueAsNumber)
                  }
                />
              </label>
            </div>

            <label className="Resize-aspect-row">
              <input
                type="checkbox"
                checked={resizeKeepAspect}
                onChange={(event) => handleResizeKeepAspectChange(event.target.checked)}
              />
              Связать ширину и высоту
            </label>

            {resizeStatusMessage && (
              <p className="Resize-validation">{resizeStatusMessage}</p>
            )}

            <div className="Resize-actions">
              <button
                className="Nav-buttons"
                type="button"
                onClick={handleApplyResize}
                disabled={Boolean(resizeValidation)}
              >
                Применить
              </button>
              <button className="Nav-buttons" type="button" onClick={closeResizeDialog}>
                Отмена
              </button>
            </div>
          </dialog>

        <div className="Workspace-layout">
          <section className="Future-tools">
            <div className="Channels-panel">
              <h4>Каналы</h4>
              <div className="Channels-list">
                {(channelMode === "gray" ? (["gray"] as ChannelKey[]) : (["r", "g", "b"] as ChannelKey[])).map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    className={`Channel-card ${channelVisibility[channel] ? "active" : ""}`}
                    onClick={() => toggleChannelVisibility(channel)}
                  >
                    <span className="Channel-name">
                      {channel === "gray" ? "Gray" : channel.toUpperCase()}
                    </span>
                    {channelThumbnails[channel] ? (
                      <img
                        className="Channel-thumb"
                        src={channelThumbnails[channel] as string}
                        alt={`${channel === "gray" ? "Gray" : channel.toUpperCase()} channel preview`}
                      />
                    ) : (
                      <span className="Channel-thumb-placeholder">Нет данных</span>
                    )}
                  </button>
                ))}

                {hasAlphaChannel && (
                  <button
                    type="button"
                    className={`Channel-card ${channelVisibility.a ? "active" : ""}`}
                    onClick={() => toggleChannelVisibility("a")}
                  >
                    <span className="Channel-name">A</span>
                    {channelThumbnails.a ? (
                      <img
                        className="Channel-thumb"
                        src={channelThumbnails.a}
                        alt="Alpha channel preview"
                      />
                    ) : (
                      <span className="Channel-thumb-placeholder">Нет данных</span>
                    )}
                  </button>
                )}
              </div>
              <p className="Channels-help">
                Нажмите на канал, чтобы включить или выключить его отображение на канвасе.
              </p>
            </div>
          </section>
          <section className="Canvas-workspace">
            <div className="canvas-container" ref={canvasContainerRef}>
              <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                id="myCanvas"
                onMouseDown={handleCanvasMouseDown}
                className={activeTool === "eyedropper" ? "eyedropper-active" : ""}
              >
                Your browser does not support the HTML canvas tag.
              </canvas>
            </div>
          <div className="canvas-info">
            <span>
              Глубина цвета:{" "}
              {loadedImageInfo ? `${loadedImageInfo.colorDepthBits} бит` : "—"}
            </span>
            <span>
              Разрешение:{" "}
              {loadedImageInfo
                ? `${loadedImageInfo.width} x ${loadedImageInfo.height}`
                : "—"}
            </span>
            <label className="View-scale-control">
              Масштаб:
              <input
                type="range"
                min={MIN_VIEW_SCALE_PERCENT}
                max={MAX_VIEW_SCALE_PERCENT}
                step={1}
                value={viewScalePercent}
                disabled={!currentImage}
                onChange={(event) =>
                  handleViewScaleChange(event.target.valueAsNumber)
                }
              />
              <span>{viewScalePercent}%</span>
            </label>
            <span>
              Пипетка:{" "}
              {pickedPixel
                ? `X:${pickedPixel.x}, Y:${pickedPixel.y} | RGB(${pickedPixel.r}, ${pickedPixel.g}, ${pickedPixel.b}) | LAB(${pickedPixel.l.toFixed(2)}, ${pickedPixel.labA.toFixed(2)}, ${pickedPixel.labB.toFixed(2)})`
                : "—"}
            </span>
          </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
