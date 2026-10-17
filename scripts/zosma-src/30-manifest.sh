# ---------------------------------------------------------------------------
# Strict fixed-key release-manifest reader (values are data, never shell)
# ---------------------------------------------------------------------------

parse_manifest_file() {
  # Manifest fields become command-global state.
# shellcheck disable=SC2034
  mf_path=$1
  ZM_MF_SCHEMA=
  ZM_MF_VERSION=
  ZM_MF_SUMS_URL=
  ZM_MF_CLI_URL=
  ZM_MF_CLI_SHA256=
  ZM_MF_DOCKER_IMAGE=
  # archive_<target>_url / _sha256
  ZM_MF_ARCHIVE=
  seen=
  count=0

  while IFS= read -r line; do
    case "$line" in
      '') continue ;;
      *=*)
        key=${line%%=*}
        value=${line#*=}
        case " $seen " in
          *" $key "*) { err "error: duplicate manifest key: $key"; return "$EXIT_VERIFY"; } ;;
        esac
        seen=$seen" $key"
        count=$((count + 1))
        case "$key" in
          installer_schema)
            [ "$value" = "$ZOSMA_INSTALLER_SCHEMA" ] || {
              err "error: unsupported installer schema"; return "$EXIT_VERIFY";
            }
            ZM_MF_SCHEMA=$value
            ;;
          version)
            valid_version "$value" || { err "error: invalid manifest version"; return "$EXIT_VERIFY"; }
            ZM_MF_VERSION=$value
            ;;
          sha256sums_url)
            case "$value" in
              https://*) : ;;
              *) err "error: manifest URL must use https: $key"; return "$EXIT_VERIFY" ;;
            esac
            [ "${value##*/}" = "SHA256SUMS" ] || {
              err "error: SHA256SUMS URL basename mismatch"; return "$EXIT_VERIFY";
            }
            ZM_MF_SUMS_URL=$value
            ;;
          cli_url)
            case "$value" in
              https://*) : ;;
              *) err "error: manifest URL must use https: $key"; return "$EXIT_VERIFY" ;;
            esac
            ZM_MF_CLI_URL=$value
            ;;
          cli_sha256)
            valid_hex "$value" || { err "error: invalid cli_sha256"; return "$EXIT_VERIFY"; }
            [ "${#value}" -eq 64 ] || { err "error: invalid cli_sha256 length"; return "$EXIT_VERIFY"; }
            ZM_MF_CLI_SHA256=$value
            ;;
          archive_*_url)
            case "$value" in
              https://*) : ;;
              *) err "error: manifest URL must use https: $key"; return "$EXIT_VERIFY" ;;
            esac
            case "$key" in
              archive_linux_x64_url) ZM_MF_ARCH_LINUX_X64_URL=$value ;;
              archive_linux_arm64_url) ZM_MF_ARCH_LINUX_ARM64_URL=$value ;;
              archive_darwin_x64_url) ZM_MF_ARCH_DARWIN_X64_URL=$value ;;
              archive_darwin_arm64_url) ZM_MF_ARCH_DARWIN_ARM64_URL=$value ;;
            esac
            ;;
          archive_*_sha256)
            valid_hex "$value" || { err "error: invalid archive checksum: $key"; return "$EXIT_VERIFY"; }
            [ "${#value}" -eq 64 ] || { err "error: invalid archive checksum length: $key"; return "$EXIT_VERIFY"; }
            case "$key" in
              archive_linux_x64_sha256) ZM_MF_ARCH_LINUX_X64_SHA256=$value ;;
              archive_linux_arm64_sha256) ZM_MF_ARCH_LINUX_ARM64_SHA256=$value ;;
              archive_darwin_x64_sha256) ZM_MF_ARCH_DARWIN_X64_SHA256=$value ;;
              archive_darwin_arm64_sha256) ZM_MF_ARCH_DARWIN_ARM64_SHA256=$value ;;
            esac
            ;;
          docker_image)
            valid_digest_ref "$value" || {
              err "error: invalid docker_image digest reference"; return "$EXIT_VERIFY";
            }
            ZM_MF_DOCKER_IMAGE=$value
            ;;
          *)
            err "error: unknown manifest key: $key"
            return "$EXIT_VERIFY"
            ;;
        esac
        ;;
      *)
        err "error: malformed manifest line"
        return "$EXIT_VERIFY"
        ;;
    esac
  done < "$mf_path"

  expected=""
  for key in installer_schema version sha256sums_url cli_url cli_sha256 \
    archive_linux_x64_url archive_linux_x64_sha256 \
    archive_linux_arm64_url archive_linux_arm64_sha256 \
    archive_darwin_x64_url archive_darwin_x64_sha256 \
    archive_darwin_arm64_url archive_darwin_arm64_sha256 \
    docker_image; do
    expected=$expected" $key"
  done
  [ "$seen" = "$expected" ] || {
    err "error: manifest is missing required keys"
    return "$EXIT_VERIFY"
  }
  return 0
}


# ---------------------------------------------------------------------------
