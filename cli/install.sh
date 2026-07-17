#!/usr/bin/env bash
set -e

BASE="https://ducktape-5a3wvrzq.sauna.new"
DIR="$HOME/.ducktape"
BIN="$HOME/.local/bin"

echo "🦆 Installing DuckTape CLI…"

if ! command -v node >/dev/null 2>&1; then
  echo "  ✗ Node.js not found. Install Node 18+ first (https://nodejs.org)." >&2
  exit 1
fi

mkdir -p "$DIR" "$BIN"
curl -fsSL "$BASE/cli/ducktape.mjs" -o "$DIR/ducktape.mjs"

cat > "$BIN/ducktape" <<EOF
#!/usr/bin/env bash
exec node "$DIR/ducktape.mjs" "\$@"
EOF
chmod +x "$BIN/ducktape"

echo "  ✓ Installed to $BIN/ducktape"

case ":$PATH:" in
  *":$BIN:"*) : ;;
  *) echo "  ! Add $BIN to your PATH:  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc" ;;
esac

echo ""
echo "Next:"
echo "  1) Get your token: open $BASE/admin/cli-token (signed in as the app owner)"
echo "  2) ducktape login <token>"
echo "  3) ducktape ask \"hi\""
