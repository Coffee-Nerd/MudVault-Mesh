/*
 * Simple JSON Parser/Generator for MudVault Mesh DikuMUD Integration
 * 
 * This is a minimal JSON implementation to avoid external dependencies.
 * For production use, consider using a full JSON library like cJSON.
 */

#include "sysdep.h"
#include "structs.h"
#include "utils.h"
#include "mudvault_mesh.h"

/* =================================================================== */
/* JSON PARSING FUNCTIONS                                             */
/* =================================================================== */

/*
 * Find a JSON key and return its string value
 */
char *imc_json_get_string(const char *json, const char *key) {
    char *search_key, *key_pos, *value_start, *value_end;
    char *result;
    int len;
    
    if (!json || !key) return NULL;
    
    /* Build search pattern: "key": */
    search_key = malloc(strlen(key) + 10);
    sprintf(search_key, "\"%s\":", key);
    
    /* Find the key */
    key_pos = strstr(json, search_key);
    if (!key_pos) {
        free(search_key);
        return NULL;
    }
    free(search_key);
    
    /* Move past the key to the value */
    value_start = strchr(key_pos, ':');
    if (!value_start) return NULL;
    value_start++;
    
    /* Skip whitespace */
    while (*value_start == ' ' || *value_start == '\t' || 
           *value_start == '\n' || *value_start == '\r') {
        value_start++;
    }
    
    /* Check if it's a string value (starts with quote) */
    if (*value_start != '"') {
        return NULL; /* Not a string value */
    }
    
    value_start++; /* Skip opening quote */
    
    /* Find closing quote (handle escaped quotes) */
    value_end = value_start;
    while (*value_end && *value_end != '"') {
        if (*value_end == '\\' && *(value_end + 1)) {
            value_end += 2; /* Skip escaped character */
        } else {
            value_end++;
        }
    }
    
    if (*value_end != '"') return NULL; /* Unterminated string */
    
    /* Extract the string */
    len = value_end - value_start;
    result = malloc(len + 1);
    strncpy(result, value_start, len);
    result[len] = '\0';
    
    /* Unescape the string */
    return imc_unescape_json(result);
}

/*
 * Find a JSON key and return its integer value
 */
int imc_json_get_int(const char *json, const char *key) {
    char *search_key, *key_pos, *value_start, *value_end;
    char value_str[32];
    int len, result;
    
    if (!json || !key) return 0;
    
    /* Build search pattern */
    search_key = malloc(strlen(key) + 10);
    sprintf(search_key, "\"%s\":", key);
    
    /* Find the key */
    key_pos = strstr(json, search_key);
    if (!key_pos) {
        free(search_key);
        return 0;
    }
    free(search_key);
    
    /* Move past the key to the value */
    value_start = strchr(key_pos, ':');
    if (!value_start) return 0;
    value_start++;
    
    /* Skip whitespace */
    while (*value_start == ' ' || *value_start == '\t' || 
           *value_start == '\n' || *value_start == '\r') {
        value_start++;
    }
    
    /* Find end of number */
    value_end = value_start;
    while (*value_end && (isdigit(*value_end) || *value_end == '-' || *value_end == '+')) {
        value_end++;
    }
    
    /* Extract number */
    len = value_end - value_start;
    if (len >= sizeof(value_str)) len = sizeof(value_str) - 1;
    strncpy(value_str, value_start, len);
    value_str[len] = '\0';
    
    return atoi(value_str);
}

/*
 * Find a JSON key and return its boolean value
 */
bool imc_json_get_bool(const char *json, const char *key) {
    char *search_key, *key_pos, *value_start;
    
    if (!json || !key) return FALSE;
    
    /* Build search pattern */
    search_key = malloc(strlen(key) + 10);
    sprintf(search_key, "\"%s\":", key);
    
    /* Find the key */
    key_pos = strstr(json, search_key);
    if (!key_pos) {
        free(search_key);
        return FALSE;
    }
    free(search_key);
    
    /* Move past the key to the value */
    value_start = strchr(key_pos, ':');
    if (!value_start) return FALSE;
    value_start++;
    
    /* Skip whitespace */
    while (*value_start == ' ' || *value_start == '\t' || 
           *value_start == '\n' || *value_start == '\r') {
        value_start++;
    }
    
    /* Check for true/false */
    if (strncmp(value_start, "true", 4) == 0) {
        return TRUE;
    } else if (strncmp(value_start, "false", 5) == 0) {
        return FALSE;
    }
    
    return FALSE;
}

/* =================================================================== */
/* JSON GENERATION FUNCTIONS                                          */
/* =================================================================== */

/*
 * Create a new JSON object
 */
char *imc_json_create_object(void) {
    char *json = malloc(2);
    strcpy(json, "{");
    return json;
}

/*
 * Add a string field to a JSON object
 */
void imc_json_add_string(char **json, const char *key, const char *value) {
    char *escaped_value, *new_json;
    int new_len;
    bool first_field;
    
    if (!json || !*json || !key || !value) return;
    
    /* Check if this is the first field */
    first_field = (strlen(*json) == 1 && (*json)[0] == '{');
    
    /* Escape the value */
    escaped_value = imc_escape_json(value);
    
    /* Calculate new length */
    new_len = strlen(*json) + strlen(key) + strlen(escaped_value) + 10;
    
    /* Allocate new buffer */
    new_json = malloc(new_len);
    
    /* Build new JSON */
    if (first_field) {
        sprintf(new_json, "{\"%s\":\"%s\"", key, escaped_value);
    } else {
        sprintf(new_json, "%s,\"%s\":\"%s\"", *json, key, escaped_value);
    }
    
    /* Replace old JSON */
    free(*json);
    free(escaped_value);
    *json = new_json;
}

/*
 * Add an integer field to a JSON object
 */
void imc_json_add_int(char **json, const char *key, int value) {
    char *new_json;
    int new_len;
    bool first_field;
    
    if (!json || !*json || !key) return;
    
    /* Check if this is the first field */
    first_field = (strlen(*json) == 1 && (*json)[0] == '{');
    
    /* Calculate new length */
    new_len = strlen(*json) + strlen(key) + 20; /* 20 should be enough for any int */
    
    /* Allocate new buffer */
    new_json = malloc(new_len);
    
    /* Build new JSON */
    if (first_field) {
        sprintf(new_json, "{\"%s\":%d", key, value);
    } else {
        sprintf(new_json, "%s,\"%s\":%d", *json, key, value);
    }
    
    /* Replace old JSON */
    free(*json);
    *json = new_json;
}

/*
 * Add a boolean field to a JSON object
 */
void imc_json_add_bool(char **json, const char *key, bool value) {
    char *new_json;
    int new_len;
    bool first_field;
    
    if (!json || !*json || !key) return;
    
    /* Check if this is the first field */
    first_field = (strlen(*json) == 1 && (*json)[0] == '{');
    
    /* Calculate new length */
    new_len = strlen(*json) + strlen(key) + 10;
    
    /* Allocate new buffer */
    new_json = malloc(new_len);
    
    /* Build new JSON */
    if (first_field) {
        sprintf(new_json, "{\"%s\":%s", key, value ? "true" : "false");
    } else {
        sprintf(new_json, "%s,\"%s\":%s", *json, key, value ? "true" : "false");
    }
    
    /* Replace old JSON */
    free(*json);
    *json = new_json;
}

/*
 * Add an object field to a JSON object
 */
void imc_json_add_object(char **json, const char *key, const char *object) {
    char *new_json;
    int new_len;
    bool first_field;
    
    if (!json || !*json || !key || !object) return;
    
    /* Check if this is the first field */
    first_field = (strlen(*json) == 1 && (*json)[0] == '{');
    
    /* Calculate new length */
    new_len = strlen(*json) + strlen(key) + strlen(object) + 10;
    
    /* Allocate new buffer */
    new_json = malloc(new_len);
    
    /* Build new JSON */
    if (first_field) {
        sprintf(new_json, "{\"%s\":%s", key, object);
    } else {
        sprintf(new_json, "%s,\"%s\":%s", *json, key, object);
    }
    
    /* Replace old JSON */
    free(*json);
    *json = new_json;
}

/*
 * Finalize a JSON object (add closing brace)
 */
char *imc_json_finalize(char *json) {
    char *new_json;
    int len;
    
    if (!json) return NULL;
    
    len = strlen(json);
    new_json = malloc(len + 2);
    strcpy(new_json, json);
    strcat(new_json, "}");
    
    free(json);
    return new_json;
}

/* =================================================================== */
/* JSON UTILITY FUNCTIONS                                             */
/* =================================================================== */

/*
 * Escape special characters in a JSON string
 */
char *imc_escape_json(const char *str) {
    char *result;
    int i, j, len;
    
    if (!str) return strdup("");
    
    len = strlen(str);
    result = malloc(len * 2 + 1); /* Worst case: every char needs escaping */
    
    for (i = 0, j = 0; i < len; i++) {
        switch (str[i]) {
            case '"':
                result[j++] = '\\';
                result[j++] = '"';
                break;
            case '\\':
                result[j++] = '\\';
                result[j++] = '\\';
                break;
            case '\b':
                result[j++] = '\\';
                result[j++] = 'b';
                break;
            case '\f':
                result[j++] = '\\';
                result[j++] = 'f';
                break;
            case '\n':
                result[j++] = '\\';
                result[j++] = 'n';
                break;
            case '\r':
                result[j++] = '\\';
                result[j++] = 'r';
                break;
            case '\t':
                result[j++] = '\\';
                result[j++] = 't';
                break;
            default:
                if (str[i] < 32) {
                    /* Control character - escape as \uXXXX */
                    sprintf(&result[j], "\\u%04x", (unsigned char)str[i]);
                    j += 6;
                } else {
                    result[j++] = str[i];
                }
                break;
        }
    }
    
    result[j] = '\0';
    
    /* Resize to actual size */
    result = realloc(result, j + 1);
    return result;
}

/*
 * Unescape special characters in a JSON string
 */
char *imc_unescape_json(const char *str) {
    char *result;
    int i, j, len;
    
    if (!str) return strdup("");
    
    len = strlen(str);
    result = malloc(len + 1);
    
    for (i = 0, j = 0; i < len; i++) {
        if (str[i] == '\\' && i + 1 < len) {
            switch (str[i + 1]) {
                case '"':
                    result[j++] = '"';
                    i++;
                    break;
                case '\\':
                    result[j++] = '\\';
                    i++;
                    break;
                case 'b':
                    result[j++] = '\b';
                    i++;
                    break;
                case 'f':
                    result[j++] = '\f';
                    i++;
                    break;
                case 'n':
                    result[j++] = '\n';
                    i++;
                    break;
                case 'r':
                    result[j++] = '\r';
                    i++;
                    break;
                case 't':
                    result[j++] = '\t';
                    i++;
                    break;
                case 'u':
                    /* Unicode escape - \uXXXX */
                    if (i + 5 < len) {
                        int unicode_val;
                        char unicode_str[5];
                        strncpy(unicode_str, &str[i + 2], 4);
                        unicode_str[4] = '\0';
                        unicode_val = strtol(unicode_str, NULL, 16);
                        if (unicode_val < 128) {
                            result[j++] = (char)unicode_val;
                        } else {
                            /* For simplicity, just use '?' for non-ASCII */
                            result[j++] = '?';
                        }
                        i += 5;
                    } else {
                        result[j++] = str[i];
                    }
                    break;
                default:
                    result[j++] = str[i];
                    break;
            }
        } else {
            result[j++] = str[i];
        }
    }
    
    result[j] = '\0';
    
    /* Resize to actual size */
    result = realloc(result, j + 1);
    return result;
}