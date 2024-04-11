git fetch --tags
NOW=$(git describe --tags)
echo "Current version: $NOW"
LAST=$(curl -s https://api.github.com/repos/VOICEVOX/voicevox/releases/latest | jq -r .tag_name)
echo "Latest version: $LAST"
if [ $LAST != $NOW ]; then
  echo "Update found"
  git checkout refs/tags/$LAST
  chmod 777 -R /root
  npm install
  npm run browser:build
else
  echo "No update found"
fi