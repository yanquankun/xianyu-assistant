import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { AiConnectionResult } from '../ai/client';
import type { DescriptionPolishOptions } from '../ai/client';
import { removeBlankDescriptionLines } from '../ai/description-format';
import type {
  DescriptionPolishResult,
  ExpansionPreview as ExpansionPreviewValue
} from '../ai/validation';
import { getLocalAssetIds, type ParsedProduct, type ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';
import {
  validateImageBatch,
  validateVideo,
  MAX_MEDIA_COUNT,
  MAX_TOTAL_IMAGE_BYTES
} from '../media/validation';
import type {
  StoredMediaAsset,
  StoredMediaKind,
  StoredMediaMetadata
} from '../storage/media-store';
import type { OperationLogEntry } from '../storage/operation-log';
import type { FillResult } from '../xianyu/fill';
import { parseXianyuLoginCheckResult, type XianyuLoginCheckResult } from '../xianyu/login';
import { AiSettingsForm } from './components/AiSettingsForm';
import { ConfirmDialog } from './components/ConfirmDialog';
import { LoginBanner } from './components/LoginBanner';
import { OperationLog } from './components/OperationLog';
import { ProductEditor } from './components/ProductEditor';
import { createTextTypewriter, type TextTypewriter } from './text-typewriter';
import {
  createManualDraft,
  draftNeedsResetConfirmation,
  initialWorkflowState,
  reduceWorkflow,
  type PanelView
} from './state';

export type PanelSide = 'left' | 'right' | 'unknown';

export interface SidePanelServices {
  loadSettings(): Promise<AiSettings | null>;
  saveSettings(settings: AiSettings): Promise<void>;
  loadDraft(): Promise<ProductDraft | null>;
  saveDraft(draft: ProductDraft): Promise<void>;
  clearDraft(): Promise<void>;
  saveMedia(file: File, kind: StoredMediaKind): Promise<StoredMediaMetadata>;
  loadMedia(assetId: string): Promise<StoredMediaAsset | null>;
  deleteMedia(assetId: string): Promise<void>;
  cleanupMedia(referencedAssetIds: readonly string[]): Promise<void>;
  parseProduct(url: string): Promise<ParsedProduct>;
  testAiConnection(settings: AiSettings): Promise<AiConnectionResult>;
  expandDraft(settings: AiSettings, draft: ProductDraft): Promise<ExpansionPreviewValue>;
  polishDescription(
    settings: AiSettings,
    draft: ProductDraft,
    options: DescriptionPolishOptions
  ): Promise<DescriptionPolishResult>;
  checkXianyuLogin(): Promise<XianyuLoginCheckResult>;
  fillDraft(draft: ProductDraft): Promise<FillResult>;
  openXianyuLogin(): Promise<void>;
  getPanelSide(): Promise<PanelSide>;
  loadLogs(): Promise<OperationLogEntry[]>;
  clearLogs(): Promise<void>;
}

const EMPTY_SETTINGS: AiSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.3,
  systemInstruction: ''
};

const NAVIGATION: { id: PanelView; label: string }[] = [
  { id: 'product', label: '商品整理' },
  { id: 'settings', label: 'AI 配置' },
  { id: 'logs', label: '运行记录' }
];

interface ResetConfirmation {
  draftId: string;
  draftUpdatedAt: string;
}

interface DescriptionPolishSession {
  requestId: number;
  draftId: string;
  originalDescription: string;
  streamedDescription: string;
  status: 'streaming' | 'completed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试';
}

function operationId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `operation-${String(Date.now())}`;
}

export function App({
  services,
  appVersion
}: {
  services: SidePanelServices;
  appVersion?: string;
}) {
  const [state, dispatch] = useReducer(reduceWorkflow, initialWorkflowState);
  const [settings, setSettings] = useState<AiSettings>(EMPTY_SETTINGS);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [isLoginRefreshing, setIsLoginRefreshing] = useState(false);
  const [logs, setLogs] = useState<OperationLogEntry[]>([]);
  const [isDeleteLogsConfirmationOpen, setIsDeleteLogsConfirmationOpen] = useState(false);
  const [isDeletingLogs, setIsDeletingLogs] = useState(false);
  const [deleteLogsError, setDeleteLogsError] = useState('');
  const [panelSide, setPanelSide] = useState<PanelSide>('unknown');
  const [resetConfirmation, setResetConfirmation] = useState<ResetConfirmation | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isUploadingVideos, setIsUploadingVideos] = useState(false);
  const [descriptionPolish, setDescriptionPolish] = useState<DescriptionPolishSession | null>(null);
  const [isRestoreConfirmationOpen, setIsRestoreConfirmationOpen] = useState(false);
  const draftSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestDraftRef = useRef<ProductDraft | null>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const returnToStartButtonRef = useRef<HTMLButtonElement>(null);
  const aiPolishButtonRef = useRef<HTMLButtonElement>(null);
  const restoreDescriptionButtonRef = useRef<HTMLButtonElement>(null);
  const focusSourceAfterResetRef = useRef(false);
  const focusReturnAfterDialogRef = useRef(false);
  const restoreDescriptionFocusTargetRef = useRef<'polish' | 'restore' | null>(null);
  const workflowGenerationRef = useRef(0);
  const initializationGenerationRef = useRef(0);
  const imageUploadRequestRef = useRef(0);
  const videoUploadRequestRef = useRef(0);
  const mediaSlotReservationsRef = useRef(new Map<string, { draftId: string; count: number }>());
  const loginCheckRequestRef = useRef(0);
  const pendingMediaAssetIdsRef = useRef(new Set<string>());
  const descriptionPolishRequestRef = useRef<{
    requestId: number;
    controller: AbortController;
  } | null>(null);
  const descriptionPolishRequestIdRef = useRef(0);
  const descriptionTypewriterRef = useRef<{
    requestId: number;
    player: TextTypewriter;
  } | null>(null);

  const cancelDescriptionTypewriter = () => {
    descriptionTypewriterRef.current?.player.cancel();
    descriptionTypewriterRef.current = null;
  };

  const clearDescriptionTypewriter = (requestId: number) => {
    if (descriptionTypewriterRef.current?.requestId === requestId) {
      descriptionTypewriterRef.current = null;
    }
  };

  const checkXianyuLogin = useCallback(
    async (isRefreshRequest: boolean): Promise<void> => {
      const requestToken = loginCheckRequestRef.current + 1;
      loginCheckRequestRef.current = requestToken;
      setIsLoginRefreshing(isRefreshRequest);
      try {
        const result = parseXianyuLoginCheckResult(await services.checkXianyuLogin());
        if (result === null) {
          throw new Error('扩展后台返回了无法识别的登录状态');
        }
        if (loginCheckRequestRef.current !== requestToken) {
          return;
        }
        dispatch({ type: 'LOGIN_STATE_CHANGED', loginState: result.state });
        setLoginMessage(result.message);
      } catch (error) {
        if (loginCheckRequestRef.current !== requestToken) {
          return;
        }
        dispatch({ type: 'LOGIN_STATE_CHANGED', loginState: 'unknown' });
        setLoginMessage(`检查闲鱼登录状态失败：${errorMessage(error)}`);
      } finally {
        if (loginCheckRequestRef.current === requestToken) {
          setIsLoginRefreshing(false);
        }
      }
    },
    [services]
  );

  useEffect(() => {
    latestDraftRef.current = state.draft;
  }, [state.draft]);

  useEffect(
    () => () => {
      descriptionPolishRequestRef.current?.controller.abort();
      descriptionPolishRequestRef.current = null;
      cancelDescriptionTypewriter();
    },
    []
  );

  useEffect(() => {
    if (resetConfirmation === null && focusReturnAfterDialogRef.current) {
      focusReturnAfterDialogRef.current = false;
      returnToStartButtonRef.current?.focus();
    }
  }, [resetConfirmation]);

  useEffect(() => {
    if (isRestoreConfirmationOpen || restoreDescriptionFocusTargetRef.current === null) {
      return;
    }
    const target = restoreDescriptionFocusTargetRef.current;
    restoreDescriptionFocusTargetRef.current = null;
    if (target === 'restore') {
      restoreDescriptionButtonRef.current?.focus();
      return;
    }
    aiPolishButtonRef.current?.focus();
  }, [isRestoreConfirmationOpen]);

  useEffect(() => {
    if (state.draft === null && focusSourceAfterResetRef.current) {
      focusSourceAfterResetRef.current = false;
      sourceInputRef.current?.focus();
    }
  }, [state.draft]);

  useEffect(() => {
    let active = true;
    const initializationToken = initializationGenerationRef.current + 1;
    initializationGenerationRef.current = initializationToken;
    const isCurrentInitialization = () =>
      active && initializationGenerationRef.current === initializationToken;
    const initialize = async () => {
      void checkXianyuLogin(false);
      const [storedSettings, storedDraft, side, entries] = await Promise.all([
        services.loadSettings(),
        services.loadDraft(),
        services.getPanelSide(),
        services.loadLogs()
      ]);
      if (!isCurrentInitialization()) {
        return;
      }
      await services.cleanupMedia(storedDraft === null ? [] : getLocalAssetIds(storedDraft));
      if (!isCurrentInitialization()) {
        return;
      }
      if (storedSettings !== null) {
        setSettings(storedSettings);
      }
      if (storedDraft !== null) {
        dispatch({ type: 'DRAFT_RESTORED', draft: storedDraft });
      }
      setPanelSide(side);
      setLogs(entries);
    };
    void initialize().catch((error: unknown) => {
      if (isCurrentInitialization()) {
        dispatch({ type: 'OPERATION_FAILED', message: errorMessage(error) });
      }
    });
    return () => {
      active = false;
      loginCheckRequestRef.current += 1;
    };
  }, [checkXianyuLogin, services]);

  useEffect(() => {
    if (state.draft === null) {
      return;
    }
    const draft = state.draft;
    draftSaveQueue.current = draftSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        await services.saveDraft(draft);
        const currentDraft = latestDraftRef.current;
        const currentAssetIds = currentDraft === null ? [] : getLocalAssetIds(currentDraft);
        await services.cleanupMedia([...currentAssetIds, ...pendingMediaAssetIdsRef.current]);
        for (const assetId of getLocalAssetIds(draft)) {
          pendingMediaAssetIdsRef.current.delete(assetId);
        }
      });
    void draftSaveQueue.current.catch((error: unknown) => {
      dispatch({ type: 'OPERATION_FAILED', message: `草稿保存失败：${errorMessage(error)}` });
    });
  }, [services, state.draft]);

  useEffect(() => {
    if (state.activeView !== 'logs') {
      return;
    }
    let active = true;
    void services.loadLogs().then(
      (entries) => {
        if (active) {
          setLogs(entries);
        }
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [services, state.activeView]);

  const parseProduct = async () => {
    descriptionPolishRequestRef.current?.controller.abort();
    descriptionPolishRequestRef.current = null;
    cancelDescriptionTypewriter();
    descriptionPolishRequestIdRef.current += 1;
    setDescriptionPolish(null);
    setIsRestoreConfirmationOpen(false);
    imageUploadRequestRef.current += 1;
    videoUploadRequestRef.current += 1;
    setIsUploadingImages(false);
    setIsUploadingVideos(false);
    const id = operationId();
    const workflowGeneration = workflowGenerationRef.current;
    dispatch({ type: 'PARSE_STARTED', operationId: id, url: state.sourceUrl });
    try {
      const product = await services.parseProduct(state.sourceUrl);
      if (workflowGeneration !== workflowGenerationRef.current) {
        return;
      }
      dispatch({
        type: 'PARSE_SUCCEEDED',
        operationId: id,
        product,
        now: new Date().toISOString()
      });
    } catch (error) {
      if (workflowGeneration !== workflowGenerationRef.current) {
        return;
      }
      dispatch({ type: 'PARSE_FAILED', operationId: id, message: errorMessage(error) });
    }
  };

  const restoreDescription = (draftId: string, description: string): void => {
    const draft = latestDraftRef.current;
    if (draft?.id !== draftId || draft.description === description) {
      return;
    }
    dispatch({
      type: 'DRAFT_CHANGED',
      draft: { ...draft, description, updatedAt: new Date().toISOString() }
    });
  };

  const polishDescription = async () => {
    const draft = latestDraftRef.current;
    if (draft === null || draft.description.trim().length === 0) {
      return;
    }
    const requestId = descriptionPolishRequestIdRef.current + 1;
    descriptionPolishRequestIdRef.current = requestId;
    const controller = new AbortController();
    descriptionPolishRequestRef.current = { requestId, controller };
    const originalDescription =
      descriptionPolish?.draftId === draft.id
        ? descriptionPolish.originalDescription
        : draft.description;
    setDescriptionPolish({
      requestId,
      draftId: draft.id,
      originalDescription,
      streamedDescription: '',
      status: 'streaming'
    });
    dispatch({ type: 'AI_POLISH_STATUS_CHANGED', message: 'AI 正在润色商品描述' });
    const isCurrentRequest = () =>
      descriptionPolishRequestRef.current?.requestId === requestId;
    const typewriter = createTextTypewriter((character) => {
      if (!isCurrentRequest()) {
        return;
      }
      setDescriptionPolish((session) =>
        session?.requestId === requestId && session.status === 'streaming'
          ? {
              ...session,
              streamedDescription: removeBlankDescriptionLines(
                `${session.streamedDescription}${character}`
              )
            }
          : session
      );
    });
    descriptionTypewriterRef.current = { requestId, player: typewriter };
    try {
      const result = await services.polishDescription(settings, draft, {
        signal: controller.signal,
        onDelta: (delta) => {
          if (!isCurrentRequest()) {
            return;
          }
          typewriter.push(delta);
        }
      });
      await typewriter.finish();
      clearDescriptionTypewriter(requestId);
      if (!isCurrentRequest()) {
        return;
      }
      const latestDraft = latestDraftRef.current;
      if (latestDraft?.id !== draft.id) {
        return;
      }
      dispatch({
        type: 'DRAFT_CHANGED',
        draft: {
          ...latestDraft,
          description: result.description,
          updatedAt: new Date().toISOString()
        }
      });
      setDescriptionPolish({
        requestId,
        draftId: draft.id,
        originalDescription,
        streamedDescription: result.description,
        status: 'completed'
      });
      dispatch({
        type: 'AI_POLISH_STATUS_CHANGED',
        message: 'AI 商品描述已生成，请检查内容'
      });
    } catch (error) {
      typewriter.cancel();
      clearDescriptionTypewriter(requestId);
      if (!isCurrentRequest()) {
        return;
      }
      restoreDescription(draft.id, originalDescription);
      setDescriptionPolish(null);
      dispatch({ type: 'OPERATION_FAILED', message: errorMessage(error) });
    } finally {
      if (isCurrentRequest()) {
        descriptionPolishRequestRef.current = null;
      }
    }
  };

  const stopDescriptionPolish = () => {
    const session = descriptionPolish;
    if (session?.status !== 'streaming') {
      return;
    }
    descriptionPolishRequestIdRef.current += 1;
    descriptionPolishRequestRef.current?.controller.abort();
    descriptionPolishRequestRef.current = null;
    cancelDescriptionTypewriter();
    restoreDescription(session.draftId, session.originalDescription);
    setDescriptionPolish(null);
    dispatch({
      type: 'AI_POLISH_STATUS_CHANGED',
      message: 'AI 润色已停止，商品描述已恢复'
    });
  };

  const closeDescriptionRestore = () => {
    restoreDescriptionFocusTargetRef.current = 'restore';
    setIsRestoreConfirmationOpen(false);
  };

  const confirmDescriptionRestore = () => {
    const session = descriptionPolish;
    if (session?.status !== 'completed') {
      restoreDescriptionFocusTargetRef.current = 'polish';
      setIsRestoreConfirmationOpen(false);
      return;
    }
    restoreDescription(session.draftId, session.originalDescription);
    setDescriptionPolish(null);
    restoreDescriptionFocusTargetRef.current = 'polish';
    setIsRestoreConfirmationOpen(false);
    dispatch({ type: 'AI_POLISH_STATUS_CHANGED', message: '已恢复初始商品描述' });
  };

  const fillDraft = async () => {
    if (state.draft === null) {
      return;
    }
    const id = operationId();
    const workflowGeneration = workflowGenerationRef.current;
    dispatch({ type: 'FILL_STARTED', operationId: id });
    try {
      const result = await services.fillDraft(state.draft);
      if (workflowGeneration !== workflowGenerationRef.current) {
        return;
      }
      const skipped = result.skipped.length;
      dispatch({
        type: 'FILL_FINISHED',
        operationId: id,
        message:
          skipped === 0
            ? '内容已填入闲鱼，请检查页面并手动发布'
            : `已填写部分内容，${String(skipped)} 个字段需要手动处理`
      });
      dispatch({ type: 'LOGIN_STATE_CHANGED', loginState: 'logged-in' });
      setLoginMessage('闲鱼已登录');
    } catch (error) {
      if (workflowGeneration !== workflowGenerationRef.current) {
        return;
      }
      dispatch({ type: 'FILL_FAILED', operationId: id, message: errorMessage(error) });
      await checkXianyuLogin(false);
    }
  };

  const refreshXianyuLogin = async () => {
    await checkXianyuLogin(true);
  };

  const saveSettings = async () => {
    try {
      await services.saveSettings(settings);
      setSettingsStatus('配置已保存在当前浏览器');
    } catch (error) {
      setSettingsStatus(errorMessage(error));
    }
  };

  const testConnection = async () => {
    setSettingsStatus('正在测试连接');
    try {
      const result = await services.testAiConnection(settings);
      setSettingsStatus(`连接成功，模型：${result.model}`);
    } catch (error) {
      setSettingsStatus(errorMessage(error));
    }
  };

  const createManualEntry = () => {
    const draft = createManualDraft(operationId(), new Date().toISOString());
    dispatch({ type: 'DRAFT_RESTORED', draft });
  };

  const deleteLogs = async () => {
    if (isDeletingLogs) {
      return;
    }
    setIsDeletingLogs(true);
    setDeleteLogsError('');
    try {
      await services.clearLogs();
      setLogs([]);
      setIsDeleteLogsConfirmationOpen(false);
    } catch (error) {
      setDeleteLogsError(`删除运行记录失败：${errorMessage(error)}`);
      setIsDeleteLogsConfirmationOpen(false);
    } finally {
      setIsDeletingLogs(false);
    }
  };

  const isResetConfirmationCurrent = (confirmation: ResetConfirmation): boolean => {
    const draft = latestDraftRef.current;
    return draft?.id === confirmation.draftId && draft.updatedAt === confirmation.draftUpdatedAt;
  };

  const closeResetConfirmation = () => {
    focusReturnAfterDialogRef.current = true;
    setResetConfirmation(null);
  };

  const rejectStaleResetConfirmation = () => {
    closeResetConfirmation();
    dispatch({ type: 'OPERATION_FAILED', message: '草稿已更新，请重新确认返回' });
  };

  const resetWorkflow = async (confirmation?: ResetConfirmation) => {
    if (confirmation !== undefined && !isResetConfirmationCurrent(confirmation)) {
      rejectStaleResetConfirmation();
      return;
    }
    const draft = latestDraftRef.current;
    if (draft === null || isResetting) {
      return;
    }
    const localAssetIds = getLocalAssetIds(draft);
    initializationGenerationRef.current += 1;
    imageUploadRequestRef.current += 1;
    videoUploadRequestRef.current += 1;
    setIsUploadingImages(false);
    setIsUploadingVideos(false);
    descriptionPolishRequestIdRef.current += 1;
    descriptionPolishRequestRef.current?.controller.abort();
    descriptionPolishRequestRef.current = null;
    cancelDescriptionTypewriter();
    setDescriptionPolish(null);
    setIsRestoreConfirmationOpen(false);
    setIsResetting(true);
    try {
      await draftSaveQueue.current;
      if (confirmation !== undefined && !isResetConfirmationCurrent(confirmation)) {
        rejectStaleResetConfirmation();
        return;
      }
      await services.clearDraft();
      workflowGenerationRef.current += 1;
      loginCheckRequestRef.current += 1;
      focusSourceAfterResetRef.current = true;
      dispatch({ type: 'WORKFLOW_RESET' });
      setResetConfirmation(null);
      for (const assetId of localAssetIds) {
        try {
          await services.deleteMedia(assetId);
          pendingMediaAssetIdsRef.current.delete(assetId);
        } catch {
          // Cleanup runs after every draft save and on side panel initialization.
        }
      }
      try {
        await services.cleanupMedia([]);
      } catch {
        // A future bounded cleanup retries orphaned media without restoring the deleted draft.
      }
    } catch (error) {
      closeResetConfirmation();
      dispatch({ type: 'OPERATION_FAILED', message: `草稿清除失败：${errorMessage(error)}` });
    } finally {
      setIsResetting(false);
    }
  };

  const returnToStart = () => {
    const draft = latestDraftRef.current;
    if (draft === null) {
      return;
    }
    if (draftNeedsResetConfirmation(draft)) {
      setResetConfirmation({ draftId: draft.id, draftUpdatedAt: draft.updatedAt });
      return;
    }
    void resetWorkflow();
  };

  const uploadImages = async (files: readonly File[]) => {
    if (state.draft === null || files.length === 0) {
      return;
    }
    const draftId = state.draft.id;
    const requestToken = imageUploadRequestRef.current + 1;
    const reservationKey = `image-${String(requestToken)}`;
    imageUploadRequestRef.current = requestToken;
    setIsUploadingImages(true);
    try {
      const remainingSlots =
        MAX_MEDIA_COUNT -
        state.draft.images.length -
        state.draft.videos.length -
        getReservedMediaSlots(draftId, mediaSlotReservationsRef.current);
      const validation = validateImageBatch(files, remainingSlots);
      mediaSlotReservationsRef.current.set(reservationKey, {
        draftId,
        count: validation.accepted.length
      });
      const rejected = [...validation.rejected];
      const savedImages: ProductDraft['images'] = [];
      for (const file of validation.accepted) {
        if (!isImageUploadCurrent(draftId, requestToken, latestDraftRef, imageUploadRequestRef)) {
          break;
        }
        const currentDraft = latestDraftRef.current;
        if (currentDraft === null || !hasImageCapacity(currentDraft, savedImages, file.size)) {
          rejected.push({
            fileName: file.name,
            reason: imageCapacityReason(currentDraft, savedImages, file.size)
          });
          continue;
        }
        try {
          const stored = await services.saveMedia(file, 'image');
          pendingMediaAssetIdsRef.current.add(stored.assetId);
          const latestDraft = latestDraftRef.current;
          if (
            !isImageUploadCurrent(draftId, requestToken, latestDraftRef, imageUploadRequestRef) ||
            latestDraft === null ||
            !hasImageCapacity(latestDraft, savedImages, stored.byteLength) ||
            !isImageMimeType(stored.mimeType)
          ) {
            await discardMedia(services, stored.assetId, pendingMediaAssetIdsRef.current);
            if (
              latestDraft !== null &&
              !hasImageCapacity(latestDraft, savedImages, stored.byteLength)
            ) {
              rejected.push({
                fileName: file.name,
                reason: imageCapacityReason(latestDraft, savedImages, stored.byteLength)
              });
            }
            if (!isImageMimeType(stored.mimeType)) {
              rejected.push({ fileName: file.name, reason: '仅支持 JPEG、PNG、WebP 图片' });
            }
            continue;
          }
          savedImages.push({
            id: `local-${stored.assetId}`,
            location: {
              kind: 'local',
              assetId: stored.assetId,
              fileName: stored.fileName,
              mimeType: stored.mimeType,
              byteLength: stored.byteLength
            },
            loadStatus: 'loaded'
          });
        } catch {
          rejected.push({ fileName: file.name, reason: '本地媒体保存失败' });
        }
      }

      if (!isImageUploadCurrent(draftId, requestToken, latestDraftRef, imageUploadRequestRef)) {
        return;
      }
      const notice = rejected.length === 0 ? undefined : formatRejectedFiles(rejected);
      dispatch({
        type: 'LOCAL_IMAGES_ADDED',
        draftId,
        images: savedImages,
        now: new Date().toISOString(),
        ...(notice === undefined ? {} : { notice })
      });
    } finally {
      mediaSlotReservationsRef.current.delete(reservationKey);
      if (imageUploadRequestRef.current === requestToken) {
        setIsUploadingImages(false);
      }
    }
  };

  const uploadVideos = async (files: readonly File[]) => {
    if (state.draft === null || files.length === 0) {
      return;
    }
    const draftId = state.draft.id;
    const requestToken = videoUploadRequestRef.current + 1;
    const reservationKey = `video-${String(requestToken)}`;
    videoUploadRequestRef.current = requestToken;
    setIsUploadingVideos(true);
    try {
      const rejected: { fileName: string; reason: string }[] = [];
      const acceptedFiles: {
        file: File;
        mimeType: 'video/mp4' | 'video/quicktime';
      }[] = [];
      const remainingSlots = Math.max(
        0,
        MAX_MEDIA_COUNT -
          state.draft.images.length -
          state.draft.videos.length -
          getReservedMediaSlots(draftId, mediaSlotReservationsRef.current)
      );
      for (const file of files) {
        const validation = validateVideo(file);
        if (!validation.ok) {
          rejected.push({ fileName: file.name, reason: validation.reason });
          continue;
        }
        if (acceptedFiles.length >= remainingSlots) {
          rejected.push({
            fileName: file.name,
            reason: `图片和视频合计最多只能添加 ${String(MAX_MEDIA_COUNT)} 个`
          });
          continue;
        }
        acceptedFiles.push({ file, mimeType: validation.mimeType });
      }
      mediaSlotReservationsRef.current.set(reservationKey, {
        draftId,
        count: acceptedFiles.length
      });
      const savedVideos: ProductDraft['videos'] = [];
      for (const { file, mimeType } of acceptedFiles) {
        if (!isVideoUploadCurrent(draftId, requestToken, latestDraftRef, videoUploadRequestRef)) {
          break;
        }
        const currentDraft = latestDraftRef.current;
        if (
          currentDraft === null ||
          currentDraft.images.length + currentDraft.videos.length + savedVideos.length >=
            MAX_MEDIA_COUNT
        ) {
          rejected.push({
            fileName: file.name,
            reason: `图片和视频合计最多只能添加 ${String(MAX_MEDIA_COUNT)} 个`
          });
          continue;
        }
        try {
          const normalizedFile = createValidatedVideoFile(file, mimeType);
          const stored = await services.saveMedia(normalizedFile, 'video');
          pendingMediaAssetIdsRef.current.add(stored.assetId);
          const latestDraft = latestDraftRef.current;
          if (
            !isVideoUploadCurrent(draftId, requestToken, latestDraftRef, videoUploadRequestRef) ||
            latestDraft === null ||
            latestDraft.images.length + latestDraft.videos.length + savedVideos.length >=
              MAX_MEDIA_COUNT ||
            !isVideoMimeType(stored.mimeType)
          ) {
            await discardMedia(services, stored.assetId, pendingMediaAssetIdsRef.current);
            if (!isVideoMimeType(stored.mimeType)) {
              rejected.push({ fileName: file.name, reason: '仅支持 MP4、MOV 视频' });
            } else if (latestDraft !== null) {
              rejected.push({
                fileName: file.name,
                reason: `图片和视频合计最多只能添加 ${String(MAX_MEDIA_COUNT)} 个`
              });
            }
            continue;
          }
          savedVideos.push({
            id: `local-${stored.assetId}`,
            assetId: stored.assetId,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            byteLength: stored.byteLength
          });
        } catch {
          rejected.push({ fileName: file.name, reason: '本地媒体保存失败' });
        }
      }
      if (!isVideoUploadCurrent(draftId, requestToken, latestDraftRef, videoUploadRequestRef)) {
        return;
      }
      const notice = rejected.length === 0 ? undefined : formatRejectedFiles(rejected);
      dispatch({
        type: 'VIDEOS_ADDED',
        draftId,
        videos: savedVideos,
        now: new Date().toISOString(),
        ...(notice === undefined ? {} : { notice })
      });
    } finally {
      mediaSlotReservationsRef.current.delete(reservationKey);
      if (videoUploadRequestRef.current === requestToken) {
        setIsUploadingVideos(false);
      }
    }
  };

  const removeImage = async (id: string) => {
    const image = state.draft?.images.find((candidate) => candidate.id === id);
    if (image === undefined) {
      return;
    }
    try {
      if (image.location.kind === 'local') {
        await services.deleteMedia(image.location.assetId);
        pendingMediaAssetIdsRef.current.delete(image.location.assetId);
      }
      dispatch({ type: 'IMAGE_REMOVED', id, now: new Date().toISOString() });
    } catch (error) {
      dispatch({ type: 'OPERATION_FAILED', message: `图片删除失败：${errorMessage(error)}` });
    }
  };

  const removeVideo = async (id: string) => {
    const video = state.draft?.videos.find((candidate) => candidate.id === id);
    if (video === undefined) {
      return;
    }
    try {
      await services.deleteMedia(video.assetId);
      pendingMediaAssetIdsRef.current.delete(video.assetId);
      dispatch({ type: 'VIDEO_REMOVED', id, now: new Date().toISOString() });
    } catch (error) {
      dispatch({ type: 'OPERATION_FAILED', message: `视频删除失败：${errorMessage(error)}` });
    }
  };

  const isDescriptionPolishing = descriptionPolish?.status === 'streaming';
  const isBusy =
    state.phase === 'parsing' ||
    state.phase === 'expanding' ||
    state.phase === 'filling' ||
    isDescriptionPolishing;
  const draftReadyToFill =
    state.draft !== null &&
    state.draft.title.trim().length > 0 &&
    state.draft.description.trim().length > 0 &&
    state.draft.price !== null &&
    Number.isFinite(state.draft.price) &&
    state.draft.price > 0 &&
    (state.draft.originalPrice === undefined ||
      (Number.isFinite(state.draft.originalPrice) && state.draft.originalPrice > 0)) &&
    (state.draft.shippingMethod !== '一口价' ||
      (state.draft.shippingFee !== undefined &&
        Number.isFinite(state.draft.shippingFee) &&
        state.draft.shippingFee > 0)) &&
    state.draft.images.length > 0 &&
    state.draft.images.every((image) => image.loadStatus === 'loaded');
  const fillDisabled = !draftReadyToFill || isBusy || state.loginState === 'logged-out';
  const polishDisabled =
    state.draft === null ||
    (!isDescriptionPolishing && isBusy) ||
    state.draft.description.trim().length === 0;
  const activeDescriptionPolish =
    state.draft !== null && descriptionPolish?.draftId === state.draft.id
      ? descriptionPolish
      : null;
  const displayedDescription =
    activeDescriptionPolish?.status === 'streaming'
      ? activeDescriptionPolish.streamedDescription
      : (state.draft?.description ?? '');
  const hasRestorableDescription = activeDescriptionPolish?.status === 'completed';

  return (
    <div className="app-shell">
      <div inert={resetConfirmation !== null || isRestoreConfirmationOpen}>
        <header className="app-header">
          <div className="brand-mark" aria-hidden="true">
            闲
          </div>
          <div className="brand-copy">
            <strong>
              闲鱼上架助手
              {appVersion ? <span className="brand-version">（v{appVersion}）</span> : null}
            </strong>
            <span>整理商品，确认后填表</span>
          </div>
        </header>

        <nav className="view-tabs" aria-label="主要功能">
          {NAVIGATION.map((item) => (
            <button
              className={state.activeView === item.id ? 'view-tab view-tab--active' : 'view-tab'}
              type="button"
              key={item.id}
              onClick={() => dispatch({ type: 'VIEW_CHANGED', view: item.id })}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="app-main">
          {panelSide === 'left' ? (
            <aside className="panel-note">
              侧边栏位置由 Chrome 控制。如需放在右侧，请在 Chrome 侧边栏设置中切换。
            </aside>
          ) : null}

          {state.activeView === 'product' ? (
            <>
              <LoginBanner
                state={state.loginState}
                message={loginMessage}
                isRefreshing={isLoginRefreshing}
                onRefresh={() => void refreshXianyuLogin()}
                onLogin={() => void services.openXianyuLogin()}
              />
              <section className="source-card">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">淘宝、天猫与京东</span>
                    <h1>从商品链接开始</h1>
                  </div>
                  <span className="step-number">01</span>
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="source-url">商品链接</label>
                    <span id="source-login-reminder" className="field-hint">
                      解析前请先登录对应平台
                    </span>
                  </div>
                  <div className="input-action">
                    <input
                      ref={sourceInputRef}
                      id="source-url"
                      type="url"
                      aria-describedby="source-login-reminder"
                      value={state.sourceUrl}
                      placeholder="粘贴淘宝、天猫或京东商品链接"
                      onChange={(event) =>
                        dispatch({ type: 'SOURCE_URL_CHANGED', url: event.target.value })
                      }
                    />
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={state.sourceUrl.trim().length === 0 || isBusy}
                      onClick={() => void parseProduct()}
                    >
                      解析商品
                    </button>
                  </div>
                </div>
                <p className="inline-status" aria-live="polite">
                  {state.statusMessage}
                </p>
                {state.draft === null ? (
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={createManualEntry}
                  >
                    手动填写
                  </button>
                ) : null}
                {state.errorMessage === null ? null : (
                  <p className="error-message">{state.errorMessage}</p>
                )}
              </section>

              {state.draft === null ? (
                <section className="empty-state">
                  <span className="empty-state__index">02</span>
                  <h2>编辑与扩写</h2>
                  <p>解析商品，或选择手动填写，再编辑标题、价格和描述。</p>
                </section>
              ) : (
                <ProductEditor
                  draft={state.draft}
                  descriptionValue={displayedDescription}
                  isDescriptionStreaming={isDescriptionPolishing}
                  onChange={(draft) => dispatch({ type: 'DRAFT_CHANGED', draft })}
                  onImageLoadStatus={(id, loadStatus) =>
                    dispatch({ type: 'IMAGE_LOAD_STATUS_CHANGED', id, loadStatus })
                  }
                  resolveLocalAsset={(assetId) => services.loadMedia(assetId)}
                  isUploadingImages={isUploadingImages}
                  isUploadingVideos={isUploadingVideos}
                  onUploadImages={(files) => void uploadImages(files)}
                  onUploadVideos={(files) => void uploadVideos(files)}
                  onRemoveImage={(id) => void removeImage(id)}
                  onRemoveVideo={(id) => void removeVideo(id)}
                  onReturnToStart={returnToStart}
                  returnToStartButtonRef={returnToStartButtonRef}
                />
              )}
            </>
          ) : null}

          {state.activeView === 'settings' ? (
            <AiSettingsForm
              settings={settings}
              status={settingsStatus}
              onChange={setSettings}
              onSave={() => void saveSettings()}
              onTest={() => void testConnection()}
            />
          ) : null}

          {state.activeView === 'logs' ? (
            <OperationLog
              entries={logs}
              statusMessage={deleteLogsError}
              onDeleteRequested={() => {
                setDeleteLogsError('');
                setIsDeleteLogsConfirmationOpen(true);
              }}
            />
          ) : null}
        </main>

        <footer className="action-dock">
          <p>最终发布需在闲鱼页面手动完成</p>
          <div className="button-row">
            <button
              ref={aiPolishButtonRef}
              className={
                isDescriptionPolishing
                  ? 'button button--stop'
                  : 'button button--secondary'
              }
              type="button"
              disabled={!isDescriptionPolishing && polishDisabled}
              aria-busy={isDescriptionPolishing}
              onClick={() =>
                isDescriptionPolishing ? stopDescriptionPolish() : void polishDescription()
              }
            >
              {isDescriptionPolishing ? '停止润色' : 'AI 润色'}
            </button>
            {hasRestorableDescription ? (
              <button
                ref={restoreDescriptionButtonRef}
                className="button button--quiet"
                type="button"
                onClick={() => setIsRestoreConfirmationOpen(true)}
              >
                恢复
              </button>
            ) : null}
            <button
              className="button button--primary button--wide"
              type="button"
              disabled={fillDisabled}
              onClick={() => void fillDraft()}
            >
              填入闲鱼
            </button>
          </div>
        </footer>
      </div>

      {resetConfirmation === null ? null : (
        <ConfirmDialog
          title="返回选择方式"
          description="当前草稿和本地上传的媒体将被删除，运行记录和 AI 配置会保留。"
          cancelLabel="取消"
          confirmLabel="确认返回"
          isConfirming={isResetting}
          onCancel={closeResetConfirmation}
          onConfirm={() => void resetWorkflow(resetConfirmation)}
        />
      )}

      {isRestoreConfirmationOpen ? (
        <ConfirmDialog
          title="恢复初始描述"
          description="恢复后，当前 AI 润色内容将被初始商品描述替换，其他商品信息不受影响。"
          cancelLabel="取消"
          confirmLabel="确认恢复"
          isConfirming={false}
          onCancel={closeDescriptionRestore}
          onConfirm={confirmDescriptionRestore}
        />
      ) : null}

      {isDeleteLogsConfirmationOpen ? (
        <ConfirmDialog
          title="删除运行记录"
          description="删除后，当前浏览器中保存的全部运行记录将无法恢复，商品草稿和 AI 配置不受影响。"
          cancelLabel="取消"
          confirmLabel="确认删除"
          isConfirming={isDeletingLogs}
          onCancel={() => setIsDeleteLogsConfirmationOpen(false)}
          onConfirm={() => void deleteLogs()}
        />
      ) : null}
    </div>
  );
}

function isImageMimeType(value: string): value is 'image/jpeg' | 'image/png' | 'image/webp' {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

function isVideoMimeType(value: string): value is 'video/mp4' | 'video/quicktime' {
  return value === 'video/mp4' || value === 'video/quicktime';
}

function formatRejectedFiles(rejected: readonly { fileName: string; reason: string }[]): string {
  return rejected.map(({ fileName, reason }) => `${fileName}：${reason}`).join('；');
}

function localImageByteLength(draft: ProductDraft): number {
  return draft.images.reduce(
    (total, image) => (image.location.kind === 'local' ? total + image.location.byteLength : total),
    0
  );
}

function hasImageCapacity(
  draft: ProductDraft,
  pendingImages: readonly ProductDraft['images'][number][],
  nextByteLength: number
): boolean {
  const mediaCount = draft.images.length + draft.videos.length + pendingImages.length;
  const pendingByteLength = pendingImages.reduce(
    (total, image) => total + (image.location.kind === 'local' ? image.location.byteLength : 0),
    0
  );
  return (
    mediaCount < MAX_MEDIA_COUNT &&
    localImageByteLength(draft) + pendingByteLength + nextByteLength <= MAX_TOTAL_IMAGE_BYTES
  );
}

function imageCapacityReason(
  draft: ProductDraft | null,
  pendingImages: readonly ProductDraft['images'][number][],
  nextByteLength: number
): string {
  if (
    draft === null ||
    draft.images.length + draft.videos.length + pendingImages.length >= MAX_MEDIA_COUNT
  ) {
    return `图片和视频合计最多只能添加 ${String(MAX_MEDIA_COUNT)} 个`;
  }
  return localImageByteLength(draft) +
    pendingImages.reduce(
      (total, image) => total + (image.location.kind === 'local' ? image.location.byteLength : 0),
      0
    ) +
    nextByteLength >
    MAX_TOTAL_IMAGE_BYTES
    ? '图片总大小不能超过 20 MB'
    : '本地媒体保存失败';
}

function isImageUploadCurrent(
  draftId: string,
  requestToken: number,
  latestDraftRef: { current: ProductDraft | null },
  requestRef: { current: number }
): boolean {
  return latestDraftRef.current?.id === draftId && requestRef.current === requestToken;
}

function isVideoUploadCurrent(
  draftId: string,
  requestToken: number,
  latestDraftRef: { current: ProductDraft | null },
  requestRef: { current: number }
): boolean {
  return latestDraftRef.current?.id === draftId && requestRef.current === requestToken;
}

function createValidatedVideoFile(file: File, mimeType: 'video/mp4' | 'video/quicktime'): File {
  return file.type === mimeType
    ? file
    : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
}

function getReservedMediaSlots(
  draftId: string,
  reservations: ReadonlyMap<string, { draftId: string; count: number }>
): number {
  let count = 0;
  for (const reservation of reservations.values()) {
    if (reservation.draftId === draftId) {
      count += reservation.count;
    }
  }
  return count;
}

async function discardMedia(
  services: SidePanelServices,
  assetId: string,
  pendingAssetIds: Set<string>
): Promise<void> {
  pendingAssetIds.delete(assetId);
  try {
    await services.deleteMedia(assetId);
  } catch {
    // Initialization cleanup retries deletion of an asset that was never accepted into the draft.
  }
}
