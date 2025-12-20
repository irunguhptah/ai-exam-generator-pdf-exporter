import type { NextConfig } from "next";
import path from "node:path";

// Suppress the url.parse() deprecation warning since it comes from dependencies
const originalEmitWarning = process.emitWarning;
(process.emitWarning as any) = function(warning: any, type?: any, code?: any) {
  // Suppress DEP0169 (url.parse deprecation) since it comes from dependencies
  if (code === 'DEP0169') {
    return;
  }
  return (originalEmitWarning as any)(warning, type, code);
};

const LOADER = path.resolve(__dirname, 'src/visual-edits/component-tagger-loader.js');

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  outputFileTracingRoot: path.resolve(__dirname, '../../'),
  
  // Configure webpack to handle PDF.js worker
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Copy PDF.js worker to public directory
      config.resolve.alias = {
        ...config.resolve.alias,
        'pdfjs-dist/build/pdf.worker.min.js': path.resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js'),
      };
    }
    return config;
  },
  
  turbopack: {
    rules: {
      "*.{jsx,tsx}": {
        loaders: [LOADER]
      }
    }
  }
};

export default nextConfig;
