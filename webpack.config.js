const path = require('path');
const fs = require('fs');
const webpack = require('webpack');

module.exports = {
  mode: 'development',
  entry: {
    code: './src/code.ts',
    ui: './src/ui.tsx',
  },
  target: ['web', 'es6'],
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    environment: {
      arrowFunction: false,
      const: false,
      destructuring: false,
      optionalChaining: false,
    },
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        include: [
          path.join(__dirname, 'node_modules/@create-figma-plugin/ui'),
          path.join(__dirname, 'src'),
        ],
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      __html__: JSON.stringify(
        fs.readFileSync(path.join(__dirname, 'dist/ui.html'), 'utf8')
      ),
    }),
    // Library imports base.css with "!" prefix; strip it so our CSS rule applies
    new webpack.NormalModuleReplacementPlugin(/^!.*\.css$/, (resource) => {
      resource.request = resource.request.replace(/^!/, '');
    }),
  ],
  devtool: false,
};
