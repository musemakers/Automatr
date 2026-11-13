import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { Card, Btn, ErrorText } from '../components/ui.jsx';
import NewsCard from '../components/NewsCard.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { newsApi } from '../api/resources.js';
import { apiErrorMessage } from '../api/client.js';

export default function IndustryNews() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    newsApi.snapshot().then(setData).catch((e) => setError(apiErrorMessage(e)));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setError('');
    try {
      const { item } = await newsApi.refresh(data?.industry);
      setData((prev) => ({ ...prev, news: [item, ...prev.news] }));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Layout eyebrow="Workspace" title="Industry News">
      <div className="page-lede"><p>A quick scan of what&apos;s moving in your industry, refreshed daily.</p></div>

      <ErrorText>{error}</ErrorText>

      <Card>
        {!data && <LoadingSpinner label="Pulling the latest signals…" />}
        {data?.news?.map((n, i) => <NewsCard key={i} {...n} />)}
        <div className="btn-row">
          <Btn variant="primary" onClick={() => navigate('/generate')}>Use as inspiration →</Btn>
          <Btn variant="secondary" loading={refreshing} onClick={handleRefresh}>Get one more signal</Btn>
        </div>
      </Card>
    </Layout>
  );
}
