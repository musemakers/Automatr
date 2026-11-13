import React, { createContext, useContext, useState, useCallback } from 'react';
import { postsApi } from '../api/resources.js';

const WorkflowContext = createContext(null);

export function WorkflowProvider({ children }) {
  const [post, setPost] = useState(null);
  // Unsaved "Generate Media" brief (form fields, staged files, template analysis...). Lives here so it survives
  // navigating to another page and back; cleared when a new post is started.
  const [briefDraft, setBriefDraft] = useState(null);

  const refreshPost = useCallback(async (id) => {
    const { post } = await postsApi.get(id || post?._id);
    setPost(post);
    return post;
  }, [post?._id]);

  const reset = useCallback(() => {
    setPost(null);
    setBriefDraft(null);
  }, []);

  return (
    <WorkflowContext.Provider value={{ post, setPost, refreshPost, reset, briefDraft, setBriefDraft }}>
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow() {
  const ctx = useContext(WorkflowContext);
  if (!ctx) throw new Error('useWorkflow must be used within WorkflowProvider');
  return ctx;
}
