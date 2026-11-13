import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import BloomLoader from '../components/BloomLoader.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { startNextFlow } from '../utils/handoff.js';

// New Creative no longer has its own video steps (its step bar ends at "Download image"). Anything that still
// lands on /video is sent into Convert to Video with the picked creative, which opens on its Motion screen.
export default function NewCreativeVideo() {
  const navigate = useNavigate();
  const { post } = useWorkflow();
  const selected = post?.designs?.find((d) => d.label === post.selectedVariantLabel);
  const imageUrl = selected?.imageUrl || '';

  useEffect(() => {
    if (!post?._id) { navigate('/generate', { replace: true }); return; }
    if (!imageUrl) { navigate('/designs', { replace: true }); return; }
    startNextFlow(navigate, 'convert', imageUrl).catch(() => navigate('/designs', { replace: true }));
  }, [post?._id, imageUrl, navigate]);

  return (
    <Layout>
      <div style={{ position: 'relative', minHeight: 240 }}><BloomLoader label="Getting your creative ready…" /></div>
    </Layout>
  );
}
