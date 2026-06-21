import type { Configuration } from 'webpack';
import * as path from 'path';
import CopyPlugin from 'copy-webpack-plugin';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/index.ts',
  // Put your normal webpack config below here
  module: {
    rules,
  },
  plugins: [
    ...plugins,
    // Copy sql.js WASM file to the output directory
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm'),
          to: 'sql-wasm.wasm',
        },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
  // Externalize sql.js to load it at runtime (avoids webpack bundling issues with WASM)
  externals: {
    'sql.js': 'commonjs sql.js',
  },
};
