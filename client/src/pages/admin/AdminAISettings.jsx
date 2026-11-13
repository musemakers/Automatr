import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout.jsx';
import { Card, CardHead, Btn, Chip, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import BlanketInstructionsCard from '../../components/BlanketInstructionsCard.jsx';
import { adminApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';

const PROVIDER_LABELS = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  gemini: 'Google (Gemini)'
};

const COPY_MODEL_LABELS = {
  auto: 'Auto (best available)',
  gpt: 'GPT',
  claude: 'Claude',
  gemini: 'Gemini'
};

const IMAGE_MODEL_LABELS = {
  auto: 'Auto (best available)',
  gpt: 'GPT Image',
  gemini: 'Gemini',
  seedream: 'Seedream'
};

const VISION_MODEL_LABELS = {
  auto: 'Auto (best available)',
  gpt: 'GPT',
  claude: 'Claude',
  gemini: 'Gemini'
};

const VIDEO_MODEL_LABELS = {
  auto: 'Auto (best available)',
  gemini: 'Gemini (Veo)',
  kling: 'Kling',
  runway: 'Runway',
  seedance: 'Seedance'
};

const CAPABILITY_COLUMNS = [
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Image' },
  { key: 'vision', label: 'Vision' },
  { key: 'video', label: 'Video' }
];

// Shows the exact model ID(s) behind the current selection. A pinned model has one entry;
// "Auto" lists every configured provider in the order they are tried.
function ActiveModels({ models, auto }) {
  if (!models) return null;
  const live = models.filter((m) => m.configured);
  if (live.length === 0) {
    return <p className="hint" style={{ marginTop: 12 }}>No model is available yet - add the API key in <code>server/.env</code>.</p>;
  }
  return (
    <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>
        {auto && live.length > 1 ? 'Exact models, in the order they are tried:' : 'Exact model in use:'}
      </div>
      {live.map((m, i) => (
        <div key={m.provider + m.model}>
          {auto && live.length > 1 ? `${i + 1}. ` : ''}
          <code>{m.model}</code> <span style={{ color: 'var(--muted)' }}>({m.provider})</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminAISettings() {
  const [managed, setManaged] = useState({});
  useEffect(() => {
    adminApi.aiPipelineStatus().then((r) => setManaged(r.managed || {})).catch(() => {});
  }, []);
  const managedNames = Object.entries(managed).filter(([, v]) => v).map(([k]) => ({ image: 'images', video: 'video', copy: 'copy/text' }[k] || k));
  const [current, setCurrent] = useState(null);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [copyModel, setCopyModel] = useState(null);
  const [copyModelOptions, setCopyModelOptions] = useState([]);
  const [loadingCopyModel, setLoadingCopyModel] = useState(true);
  const [savingCopyModel, setSavingCopyModel] = useState(false);

  const [activeCopyModels, setActiveCopyModels] = useState(null);
  const [activeImageModels, setActiveImageModels] = useState(null);
  const [activeVideoModels, setActiveVideoModels] = useState(null);
  const [activeVisionModels, setActiveVisionModels] = useState(null);
  const [visionModel, setVisionModel] = useState(null);
  const [visionModelOptions, setVisionModelOptions] = useState([]);
  const [savingVisionModel, setSavingVisionModel] = useState(false);

  const [imageModel, setImageModel] = useState(null);
  const [imageModelOptions, setImageModelOptions] = useState([]);
  const [savingImageModel, setSavingImageModel] = useState(false);

  const [videoModel, setVideoModel] = useState(null);
  const [videoModelOptions, setVideoModelOptions] = useState([]);
  const [loadingVideoModel, setLoadingVideoModel] = useState(true);
  const [savingVideoModel, setSavingVideoModel] = useState(false);

  const [hideCosts, setHideCosts] = useState(false);
  const [savingHideCosts, setSavingHideCosts] = useState(false);

  const [providerMatrix, setProviderMatrix] = useState([]);
  const [loadingMatrix, setLoadingMatrix] = useState(true);

  function load() {
    setLoading(true);
    setError('');
    adminApi
      .getNewsSettings()
      .then(({ newsProvider, providers }) => {
        setCurrent(newsProvider);
        setProviders(providers);
      })
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
  }

  function loadCopyModel() {
    setLoadingCopyModel(true);
    adminApi
      .getGenerationSettings()
      .then(({ copyModel, models, imageModel, imageModels, visionModel, visionModels, hideCosts, activeCopyModels, activeImageModels, activeVisionModels }) => {
        setCopyModel(copyModel);
        setCopyModelOptions(models);
        setImageModel(imageModel);
        setImageModelOptions(imageModels);
        setVisionModel(visionModel || 'auto');
        setVisionModelOptions(visionModels || []);
        setActiveVisionModels(activeVisionModels);
        setHideCosts(Boolean(hideCosts));
        setActiveCopyModels(activeCopyModels);
        setActiveImageModels(activeImageModels);
      })
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoadingCopyModel(false));
  }

  function loadVideoModel() {
    setLoadingVideoModel(true);
    adminApi
      .getVideoModelSettings()
      .then(({ videoModel, videoModels, activeVideoModels }) => {
        setActiveVideoModels(activeVideoModels);
        setVideoModel(videoModel);
        setVideoModelOptions(videoModels);
      })
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoadingVideoModel(false));
  }

  function loadProviderMatrix() {
    setLoadingMatrix(true);
    adminApi
      .getProviderMatrix()
      .then(({ providers }) => setProviderMatrix(providers))
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoadingMatrix(false));
  }

  useEffect(load, []);
  useEffect(loadCopyModel, []);
  useEffect(loadVideoModel, []);
  useEffect(loadProviderMatrix, []);

  async function handleSelect(providerId) {
    if (providerId === current) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { newsProvider } = await adminApi.updateNewsSettings({ newsProvider: providerId });
      setCurrent(newsProvider);
      setSuccess('Saved.');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleSelectCopyModel(modelId) {
    if (modelId === copyModel) return;
    setSavingCopyModel(true);
    setError('');
    try {
      const { copyModel: updated, activeCopyModels: active } = await adminApi.updateGenerationSettings({ copyModel: modelId });
      setCopyModel(updated);
      setActiveCopyModels(active);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingCopyModel(false);
    }
  }

  async function handleSelectImageModel(modelId) {
    if (modelId === imageModel) return;
    setSavingImageModel(true);
    setError('');
    try {
      const { imageModel: updated, activeImageModels: active } = await adminApi.updateImageModelSettings({ imageModel: modelId });
      setImageModel(updated);
      setActiveImageModels(active);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingImageModel(false);
    }
  }

  async function handleSelectVisionModel(modelId) {
    if (modelId === visionModel) return;
    setSavingVisionModel(true);
    setError('');
    try {
      const { visionModel: updated, activeVisionModels: active } = await adminApi.updateVisionModelSettings({ visionModel: modelId });
      setVisionModel(updated);
      setActiveVisionModels(active);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingVisionModel(false);
    }
  }

  async function handleSelectVideoModel(modelId) {
    if (modelId === videoModel) return;
    setSavingVideoModel(true);
    setError('');
    try {
      const { videoModel: updated, activeVideoModels: active } = await adminApi.updateVideoModelSettings({ videoModel: modelId });
      setVideoModel(updated);
      setActiveVideoModels(active);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingVideoModel(false);
    }
  }

  async function handleToggleHideCosts() {
    const next = !hideCosts;
    setSavingHideCosts(true);
    setError('');
    try {
      const { hideCosts: updated } = await adminApi.updateGenerationSettings({ hideCosts: next });
      setHideCosts(Boolean(updated));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSavingHideCosts(false);
    }
  }

  return (
    <Layout eyebrow="Admin" title="AI Settings">
      <div className="page-lede">
        <p>
          Choose which AI provider powers the live news feed on user dashboards, and which model generates post
          copy by default. API keys themselves are never managed here — add them to <code>server/.env</code> and
          restart the server; these panels only pick among providers that are already configured.
        </p>
      </div>

      {managedNames.length > 0 && (
        <p className="hint" style={{ padding: '10px 12px', border: '1px solid var(--blue-line)', background: 'var(--blue-soft)', borderRadius: 8 }}>
          A saved AI block pipeline is driving {managedNames.join(', ')} for this workspace, so the model choices below don't apply to {managedNames.length > 1 ? 'those' : 'it'}.
          {' '}<Link to="/admin/ai-blocks">Open AI Blocks</Link> to change it or reset to these settings.
        </p>
      )}

      <ErrorText>{error}</ErrorText>
      {success && <p className="hint" style={{ color: 'var(--blue-dark)' }}>{success}</p>}

      <Card style={{ maxWidth: 620 }}>
        <CardHead title="News provider" tag={loading ? '…' : PROVIDER_LABELS[current]} />

        {loading && <LoadingSpinner label="Loading settings…" />}

        {!loading && (
          <>
            <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {providers.map((p) => (
                <Chip
                  key={p.id}
                  selected={p.id === current}
                  onClick={() => p.configured && !saving && handleSelect(p.id)}
                >
                  {PROVIDER_LABELS[p.id] || p.id}
                  {!p.configured && ' (no API key)'}
                  {p.configured && !p.live && ' (AI-generated only)'}
                </Chip>
              ))}
            </div>

            <p className="hint" style={{ marginTop: 14 }}>
              <strong>Anthropic</strong> uses Claude's live web search to pull real, cited, current news for each
              industry — this is now what users see by default on their dashboard (cached ~30 min per industry to
              limit API cost; adjust via <code>NEWS_LIVE_CACHE_MINUTES</code> in <code>.env</code>). Other providers,
              if selected, fall back to an AI-generated trend blurb instead of real search results — useful only if
              Anthropic isn't available to you, and always labeled as speculative in the UI. Providers without a key
              configured in <code>.env</code> can't be selected.
            </p>
          </>
        )}
      </Card>

      <Card style={{ maxWidth: 620 }}>
        <CardHead title="Default copy model" tag={loadingCopyModel ? '…' : COPY_MODEL_LABELS[copyModel]} />

        {loadingCopyModel && <LoadingSpinner label="Loading settings…" />}

        {!loadingCopyModel && (
          <>
            <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {copyModelOptions.map((m) => (
                <Chip
                  key={m.id}
                  selected={m.id === copyModel}
                  onClick={() => m.configured && !savingCopyModel && handleSelectCopyModel(m.id)}
                >
                  {COPY_MODEL_LABELS[m.id] || m.id}
                  {!m.configured && ' (no API key)'}
                </Chip>
              ))}
            </div>
            <ActiveModels models={activeCopyModels} auto={copyModel === 'auto'} />
            <p className="hint" style={{ marginTop: 14 }}>
              This controls which model writes post captions, headline suggestions, and copy edits workspace-wide -
              regular users no longer pick a model per-post. <strong>Auto</strong> picks whatever's configured (with
              some rotation for variety across a set of copy directions); pinning a specific model here always uses
              that one instead.
            </p>
          </>
        )}
      </Card>
      <Card style={{ maxWidth: 620 }}>
        <CardHead title="Default image model" tag={loadingCopyModel ? '…' : IMAGE_MODEL_LABELS[imageModel]} />

        {loadingCopyModel && <LoadingSpinner label="Loading settings…" />}

        {!loadingCopyModel && (
          <>
            <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {imageModelOptions.map((m) => (
                <Chip
                  key={m.id}
                  selected={m.id === imageModel}
                  onClick={() => m.configured && !savingImageModel && handleSelectImageModel(m.id)}
                >
                  {IMAGE_MODEL_LABELS[m.id] || m.id}
                  {!m.configured && ' (no API key)'}
                </Chip>
              ))}
            </div>
            <ActiveModels models={activeImageModels} auto={imageModel === 'auto'} />
            <p className="hint" style={{ marginTop: 14 }}>
              Controls which model generates creatives workspace-wide (Generate Media, format porting, and design
              variants all use this). <strong>Auto</strong> falls back to the <code>AI_IMAGE_PRIORITY</code> order in{' '}
              <code>server/.env</code>; pinning a specific model here always uses that one instead. Claude/Anthropic
              has no image API, so it isn't offered here.
            </p>
          </>
        )}
      </Card>

      <Card style={{ maxWidth: 620 }}>
        <CardHead title="Default vision model" tag={loadingCopyModel ? '…' : VISION_MODEL_LABELS[visionModel]} />

        {loadingCopyModel && <LoadingSpinner label="Loading settings…" />}

        {!loadingCopyModel && (
          <>
            <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {visionModelOptions.map((m) => (
                <Chip
                  key={m.id}
                  selected={m.id === visionModel}
                  onClick={() => m.configured && !savingVisionModel && handleSelectVisionModel(m.id)}
                >
                  {VISION_MODEL_LABELS[m.id] || m.id}
                  {!m.configured && ' (no API key)'}
                </Chip>
              ))}
            </div>
            <ActiveModels models={activeVisionModels} auto={visionModel === 'auto'} />
            <p className="hint" style={{ marginTop: 14 }}>
              Controls which model looks at images: animation ideas for video, and brand, reference and template analysis.
              <strong> Auto</strong> follows the <code>AI_VISION_PRIORITY</code> order in <code>server/.env</code>. A pinned model is
              tried first, and the others still back it up if it fails. To change the exact model version, set{' '}
              <code>ANTHROPIC_VISION_MODEL</code>, <code>OPENAI_VISION_MODEL</code> or <code>GEMINI_VISION_MODEL</code>.
            </p>
          </>
        )}
      </Card>

      <Card style={{ maxWidth: 620 }}>
        <CardHead title="Default video model" tag={loadingVideoModel ? '…' : VIDEO_MODEL_LABELS[videoModel]} />

        {loadingVideoModel && <LoadingSpinner label="Loading settings…" />}

        {!loadingVideoModel && (
          <>
            <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {videoModelOptions.map((m) => (
                <Chip
                  key={m.id}
                  selected={m.id === videoModel}
                  onClick={() => m.configured && !savingVideoModel && handleSelectVideoModel(m.id)}
                >
                  {VIDEO_MODEL_LABELS[m.id] || m.id}
                  {!m.configured && ' (no API key)'}
                </Chip>
              ))}
            </div>
            <ActiveModels models={activeVideoModels} auto={videoModel === 'auto'} />
            <p className="hint" style={{ marginTop: 14 }}>
              Controls which model generates post/format videos workspace-wide. <strong>Auto</strong> falls back to
              the <code>AI_VIDEO_PRIORITY</code> order in <code>server/.env</code>; pinning a specific model here
              always uses that one instead. <strong>Gemini</strong> here means Google's Veo model, which uses the
              same <code>GEMINI_API_KEY</code> as Gemini text/image.
            </p>
          </>
        )}
      </Card>

      <Card style={{ maxWidth: 620 }}>
        <CardHead title="Cost estimates" tag={loadingCopyModel ? '…' : hideCosts ? 'Hidden' : 'Visible'} />

        {loadingCopyModel && <LoadingSpinner label="Loading settings…" />}

        {!loadingCopyModel && (
          <>
            <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              <Chip selected={!hideCosts} onClick={() => hideCosts && !savingHideCosts && handleToggleHideCosts()}>
                Show "~$0.0X" tags (default)
              </Chip>
              <Chip selected={hideCosts} onClick={() => !hideCosts && !savingHideCosts && handleToggleHideCosts()}>
                Hide cost estimates
              </Chip>
            </div>
            <p className="hint" style={{ marginTop: 14 }}>
              Controls whether the rough per-generation dollar estimate (shown next to Generate buttons throughout
              the app) is visible to everyone in this workspace. This only hides the display - it has no effect on
              what generation actually costs or which model is used.
            </p>
          </>
        )}
      </Card>

      <BlanketInstructionsCard />

      <Card style={{ maxWidth: 620 }}>
        <CardHead title="Provider capabilities" />
        <p className="hint" style={{ marginBottom: 14 }}>
          Every provider the app knows how to call, what each one can do, and whether it's currently configured on
          this server. Add or remove API keys in <code>server/.env</code> and restart the server to change this.
        </p>

        {loadingMatrix && <LoadingSpinner label="Loading providers…" />}

        {!loadingMatrix && (
          <div className="table-scroll">
            <table style={{ width: '100%', minWidth: 480, fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>Provider</th>
                {CAPABILITY_COLUMNS.map((c) => (
                  <th key={c.key} style={{ textAlign: 'center', padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>
                    {c.label}
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {providerMatrix.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>{p.label}</td>
                  {CAPABILITY_COLUMNS.map((c) => (
                    <td key={c.key} style={{ textAlign: 'center', padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>
                      {p[c.key] ? '✓' : '—'}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--line)', color: p.configured ? 'var(--blue-dark)' : 'var(--muted)' }}>
                    {p.configured ? 'Configured' : 'No API key'}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </Card>
    </Layout>
  );
}
