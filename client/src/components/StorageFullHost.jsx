import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal.jsx';
import { Btn } from './ui.jsx';

const fmtBytes = (b) => {
  const mb = (b || 0) / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
};

/**
 * Global "storage is full" alert. Anything can raise it with window.dispatchEvent(new CustomEvent('automatr:storage-full', { detail }))
 * - the start screen before a flow opens, and the API client whenever a generate call is refused with code STORAGE_FULL
 * (so it also catches someone who was already inside a flow when the storage filled up).
 */
export default function StorageFullHost() {
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);

  useEffect(() => {
    const on = (e) => setInfo(e.detail || {});
    window.addEventListener('automatr:storage-full', on);
    return () => window.removeEventListener('automatr:storage-full', on);
  }, []);

  if (!info) return null;
  const close = () => setInfo(null);
  return (
    <Modal title="Your storage is full" onClose={close} width={480}>
      <p style={{ marginBottom: 12 }}>
        {info.limitBytes ? <>You have used <strong>{fmtBytes(info.usedBytes)}</strong> of <strong>{fmtBytes(info.limitBytes)}</strong>. </> : null}
        New creatives can&apos;t be made until there&apos;s space. Please delete some old assets first.
      </p>
      <p className="hint" style={{ marginBottom: 18 }}>Your current work stays saved under In Progress. Free up space, then come back and continue.</p>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <Btn variant="primary" onClick={() => { close(); navigate('/posts/completed'); }}>Delete old assets</Btn>
        <Btn variant="secondary" onClick={close}>Not now</Btn>
      </div>
    </Modal>
  );
}
