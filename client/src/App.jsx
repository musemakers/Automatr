import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import BrandAssets from './pages/BrandAssets.jsx';
import GenerateMedia from './pages/GenerateMedia.jsx';
import GenerateDesigns from './pages/GenerateDesigns.jsx';
import RefineOptions from './pages/RefineOptions.jsx';
import ModifyPost from './pages/ModifyPost.jsx';
import Publish from './pages/Publish.jsx';
import NewCreativeVideo from './pages/NewCreativeVideo.jsx';
import Usage from './pages/Usage.jsx';
import AllPosts from './pages/AllPosts.jsx';
import Search from './pages/Search.jsx';
import IndustryNews from './pages/IndustryNews.jsx';
import Settings from './pages/Settings.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';
import AdminIndustries from './pages/admin/AdminIndustries.jsx';
import AdminAISettings from './pages/admin/AdminAISettings.jsx';
import AdminAiUsage from './pages/admin/AdminAiUsage.jsx';
import AdminUsageEstimator from './pages/admin/AdminUsageEstimator.jsx';
import AdminCustomers from './pages/admin/AdminCustomers.jsx';
import CustomerGallery from './pages/admin/CustomerGallery.jsx';
import AdminAIBlocks from './pages/admin/AdminAIBlocks.jsx';
import AdminWorkspace from './pages/admin/AdminWorkspace.jsx';
import AdminEmailTemplates from './pages/admin/AdminEmailTemplates.jsx';
import AdminBriefStudio from './pages/admin/AdminBriefStudio.jsx';
import { ForgotPassword, ResetPassword } from './pages/PasswordPages.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';
import { WorkflowProvider } from './context/WorkflowContext.jsx';
import { LightboxProvider } from './context/LightboxContext.jsx';

export default function App() {
  return (
    <WorkflowProvider>
      <LightboxProvider>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          {/* Brand Assets lives inside the Customers tab now; the old address sends people there. */}
          <Route path="/brand" element={<Navigate to="/admin/customers" replace />} />
          <Route path="/admin/customers/:customerId/gallery" element={<ProtectedRoute><AdminRoute agencyOnly><CustomerGallery /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/customers/:customerId/brand" element={<ProtectedRoute><AdminRoute agencyOnly><BrandAssets /></AdminRoute></ProtectedRoute>} />
          <Route path="/usage" element={<ProtectedRoute><Usage /></ProtectedRoute>} />
          <Route path="/search" element={<ProtectedRoute><Search /></ProtectedRoute>} />
          <Route path="/news" element={<ProtectedRoute><IndustryNews /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

          <Route path="/generate" element={<ProtectedRoute><GenerateMedia /></ProtectedRoute>} />
          <Route path="/designs" element={<ProtectedRoute><GenerateDesigns /></ProtectedRoute>} />
          <Route path="/refine" element={<ProtectedRoute><RefineOptions /></ProtectedRoute>} />
          <Route path="/modify" element={<ProtectedRoute><ModifyPost /></ProtectedRoute>} />
          <Route path="/video" element={<ProtectedRoute><NewCreativeVideo /></ProtectedRoute>} />
          <Route path="/publish" element={<ProtectedRoute><Publish /></ProtectedRoute>} />
          <Route path="/posts" element={<ProtectedRoute><AllPosts /></ProtectedRoute>} />
          <Route path="/posts/in-progress" element={<ProtectedRoute><AllPosts filter="in-progress" /></ProtectedRoute>} />
          <Route path="/posts/completed" element={<ProtectedRoute><AllPosts filter="completed" /></ProtectedRoute>} />

          <Route path="/admin/users" element={<ProtectedRoute><AdminRoute><AdminUsers /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/customers" element={<ProtectedRoute><AdminRoute agencyOnly><AdminCustomers /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/workspace" element={<ProtectedRoute><AdminRoute agencyOnly><AdminWorkspace /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/industries" element={<ProtectedRoute><AdminRoute agencyOnly><AdminIndustries /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/ai-settings" element={<ProtectedRoute><AdminRoute agencyOnly><AdminAISettings /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/ai-blocks" element={<ProtectedRoute><AdminRoute agencyOnly><AdminAIBlocks /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/ai-usage" element={<ProtectedRoute><AdminRoute agencyOnly><AdminAiUsage /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/usage-estimator" element={<ProtectedRoute><AdminRoute agencyOnly><AdminUsageEstimator /></AdminRoute></ProtectedRoute>} />

          <Route path="/admin/email-templates" element={<ProtectedRoute><AdminRoute agencyOnly><AdminEmailTemplates /></AdminRoute></ProtectedRoute>} />
          <Route path="/admin/brief-studio" element={<ProtectedRoute><AdminRoute agencyOnly><AdminBriefStudio /></AdminRoute></ProtectedRoute>} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </LightboxProvider>
    </WorkflowProvider>
  );
}
