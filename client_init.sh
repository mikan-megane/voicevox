git fetch --tags
LAST=$(curl -s https://api.github.com/repos/VOICEVOX/voicevox/releases/latest | jq -r .tag_name)
NOW=$(git describe --tags)
if [ $LAST != $NOW ]; then
  git checkout refs/tags/$LAST
  chmod 777 -R /root
  npm install
  npm run browser:build
fi