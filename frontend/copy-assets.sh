#!/bin/bash
set -e

echo "Cleaning old assets."
rm -rf ../wh_mapper/static/wh_mapper/static
rm -rf ../wh_mapper/static/wh_mapper/assets
rm -f ../wh_mapper/static/wh_mapper/manifest.json

echo "Copying new assets."
cp build/static/.vite/manifest.json ../wh_mapper/static/wh_mapper/manifest.json
cp -r build/static/assets ../wh_mapper/static/wh_mapper/assets
cp -r build/static/static ../wh_mapper/static/wh_mapper/static

echo "Assets copied successfully."
