import React, { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { ErrorText } from '../components/ui.jsx';
import DesignLanguageCard from '../components/DesignLanguageCard.jsx';
import { useCustomerScope } from '../utils/useCustomerScope.js';
import { BrandUiProvider } from '../components/brand/BrandUi.jsx';
import { BrandDataProvider, useBrand } from '../components/brand/BrandData.jsx';
import { TABS, LIBS } from '../components/brand/brandSpec.js';
import Box from '../components/brand/Box.jsx';
import { Library } from '../components/brand/Files.jsx';
import GuidelinesPdf from '../components/brand/GuidelinesPdf.jsx';
import { LearnedCard, ReviewCard, PhotographyCard, PackageCard } from '../components/brand/GuideExtras.jsx';
import { AssetDetailsModal, OtherFilesCard, SubBrandsSection, AiSearch, ResetCard } from '../components/brand/AssetTools.jsx';

// The links the earlier four-tab screen used still open the right tab.
const OLD_TABS = { guide: 'guidelines', look: 'imagery', setup: 'languages' };

function Tabs({ tab, setTab }) {
  const brand = useBrand();
  const onKey = (e, i) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? 'h' : e.key === 'End' ? 'e' : 0;
    if (!d) return;
    e.preventDefault();
    const j = d === 'h' ? 0 : d === 'e' ? TABS.length - 1 : (i + d + TABS.length) % TABS.length;
    setTab(TABS[j].id);
    requestAnimationFrame(() => document.getElementById(`tab-${TABS[j].id}`)?.focus());
  };
  return (
    <div className="bt-wrap">
      <div className="bt" role="tablist" aria-label="Brand sections">
        {TABS.map((t, i) => {
          const n = brand.tabCount(t);
          return (
            <button
              key={t.id} id={`tab-${t.id}`} type="button" role="tab" className="bt__tab" aria-controls={`panel-${t.id}`}
              aria-selected={tab === t.id ? 'true' : 'false'} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)}
            >
              <span className="bt__label">{t.label}</span><span className="bt__n">{n ? String(n) : ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The boxes of one tab; neighbouring boxes that share a row (always do / never do, preferred / avoided words) sit side by side. */
function Boxes({ tab }) {
  const brand = useBrand();
  const out = [];
  let row = null;
  brand.boxesOf(tab).forEach((b) => {
    if (b.row) {
      if (!row || row.key !== b.row) { row = { key: b.row, boxes: [] }; out.push(row); }
      row.boxes.push(b);
    } else { row = null; out.push(b); }
  });
  return (
    <div className="bp-boxes" id={`boxes-${tab.id}`}>
      {out.map((x) => (x.boxes ? <div key={`row-${x.key}`} className="bp-row">{x.boxes.map((b) => <Box key={b.id} box={b} />)}</div> : <Box key={x.id} box={x} />))}
    </div>
  );
}

function Screen({ customerName, user, setUser }) {
  const brand = useBrand();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const want = OLD_TABS[raw] || raw;
  const tab = TABS.some((t) => t.id === want) ? want : 'guidelines';
  const setTab = (id) => setSearchParams(id === 'guidelines' ? {} : { tab: id }, { replace: true });
  const [details, setDetails] = useState(null);

  if (!brand.ready) return <div className="empty-state">Loading brand assets…</div>;
  if (brand.loadError) return <ErrorText>{brand.loadError}</ErrorText>;

  const panel = (t) => {
    const libs = LIBS.filter((l) => l.tab === t.id);
    return (
      <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id}>
        <div className="bk bk--one">
          <div className="bk__main">
            <div className="bp-intro"><h2 className="bp-intro__title">{t.title}</h2><p className="bp-intro__lead">{t.lead}</p></div>
            {t.id === 'guidelines' && <GuidelinesPdf onGoTab={setTab} />}
            <Boxes tab={t} />
            {t.id === 'guidelines' && (<><LearnedCard /><ReviewCard /><PackageCard /></>)}
            {libs.map((l) => <Library key={l.id} lib={l} onDetails={setDetails} />)}
            {t.id === 'assets' && <OtherFilesCard onOpen={setDetails} />}
            {t.id === 'imagery' && (
              <>
                <PhotographyCard />
                <DesignLanguageCard user={user} setUser={(u) => { setUser(u); brand.bump(); }} hideFonts />
              </>
            )}
            {t.id === 'languages' && <SubBrandsSection onOpen={setDetails} />}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <AiSearch customerName={customerName} onOpen={setDetails} />
      <Tabs tab={tab} setTab={setTab} />
      {TABS.map(panel)}
      <div className="bk bk--one"><div className="bk__main"><ResetCard customerName={customerName} /></div></div>
      {details && <AssetDetailsModal asset={details} onClose={() => setDetails(null)} />}
    </>
  );
}

// Super admin only. Opens from Customers -> Brand assets, so the page is always about one named customer.
export default function BrandAssets() {
  const { customerId } = useParams();
  const { user, setUser, customer, ready, error: scopeError } = useCustomerScope(customerId);
  const customerName = customer?.name || '';

  if (!ready) {
    return (
      <Layout eyebrow="Customers" title="Brand Assets">
        {scopeError ? <ErrorText>{scopeError}</ErrorText> : <div className="empty-state">Loading brand assets…</div>}
        <Link to="/admin/customers" className="link-btn">← All customers</Link>
      </Layout>
    );
  }
  return (
    <Layout eyebrow="Customers" title={customerName ? `Brand Assets · ${customerName}` : 'Brand Assets'}>
      <BrandUiProvider>
        <div style={{ marginBottom: 10 }}><Link to="/admin/customers" className="link-btn" style={{ whiteSpace: 'nowrap' }}>← All customers</Link></div>
        <BrandDataProvider customerId={customerId} setUser={setUser}>
          <Screen customerName={customerName} user={user} setUser={setUser} />
        </BrandDataProvider>
      </BrandUiProvider>
    </Layout>
  );
}
