export const GIT_TIMEOUT_MS = 10000;
export const GIT_CMD_MAX_BUFFER = 10 * 1024 * 1024;
export const GIT_STREAM_BUFFER_DEFAULT = 100 * 1024 * 1024;
export const GIT_MAX_BYTES_LIMIT = 200 * 1024 * 1024;
export const GIT_IDLE_TIMEOUT_MS = 300000;
export const GIT_ABSOLUTE_TIMEOUT_MS = 900000;
export const MAX_TRAILER_LENGTH = 5000;
export const MAX_SUBJECT_LENGTH = 5000;
export const MAX_BODY_LENGTH = 100000;
export const SIGPIPE_EXIT_CODE = 141;
export const MAX_STDERR_LENGTH = 100000;
export const EXPECTED_RECORD_PARTS = 13;
export const MAX_STATUS_ITERATIONS = 500000;
export const MAX_EMPTY_STATUS_COUNT = 10;
export const MAX_PARSED_FILES = 500;
export const MAX_ARRAY_LENGTH = 50;
export const DEFAULT_MAX_BODY_LEN = 10000;
export const MAX_FILES_PER_COMMIT = 100;
export const DEFAULT_MAX_PATCH_LEN = 20000;
export const MAX_ISSUE_TEXT_LENGTH = 5000;
export const RECORD_START_FIELDS = 9;
export const RECORD_END_FIELDS = 3;

export const CHAR_NEWLINE = 0x0A;
export const CHAR_NULL = 0x00;

export const REGEX_FILE_STATUS = /^[A-Z][A-Z\d]*$/;
export const REGEX_CONVENTIONAL_COMMIT = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s*(.*)$/;
export const REGEX_VALIDATION_TRAILER = /^(validation|history-validation|changelog-validation)(-status)?$/;
export const REGEX_REFERENCE_TRAILER = /^(acked-by|bug|cc|closes|depends-on|fixes|refs|references|related-to|reported-by|resolves|see-also|signed-off-by|tested-by)$/;
export const REGEX_BREAKING_CHANGE = /(?:^|\n)BREAKING[\s-]CHANGES?:?[ \t]*\n?([\s\S]*?)(?:\n\n|$)/i;
export const REGEX_REVERT_COMMIT = /This reverts commit ([a-f0-9]{7,40})/;

export const GIT_EXCLUDE_PATTERNS = [
  ':(exclude)*.lock', ':(exclude)*-lock.json', ':(exclude)*.min.js', ':(exclude)*.map',
  ':(exclude)pnpm-workspace.yaml', ':(exclude)pnpm-lock.yaml',
  ':(exclude)*.svg', ':(exclude)*.png', ':(exclude)*.jpg', ':(exclude)*.jpeg', ':(exclude)*.gif',
  ':(exclude)**/dist/*', ':(exclude)**/build/*', ':(exclude)**/coverage/*',
  ':(exclude)*.csv', ':(exclude)*.txt',
  ':(exclude)go.sum', ':(exclude)**/.pnp.*', ':(exclude)**/vendor/*'
];

export const MS_PER_DAY = 1000 * 60 * 60 * 24;
export const IMPACT_HIGH = 0.8;
export const IMPACT_MEDIUM = 0.5;
export const IMPACT_LOW = 0.2;
