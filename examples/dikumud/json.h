/*
 * Simple JSON Header for MudVault Mesh DikuMUD Integration
 */

#ifndef JSON_H
#define JSON_H

/* JSON parsing functions */
char *imc_json_get_string(const char *json, const char *key);
int   imc_json_get_int(const char *json, const char *key);
bool  imc_json_get_bool(const char *json, const char *key);

/* JSON generation functions */
char *imc_json_create_object(void);
void  imc_json_add_string(char **json, const char *key, const char *value);
void  imc_json_add_int(char **json, const char *key, int value);
void  imc_json_add_bool(char **json, const char *key, bool value);
void  imc_json_add_object(char **json, const char *key, const char *object);
char *imc_json_finalize(char *json);

/* JSON utility functions */
char *imc_escape_json(const char *str);
char *imc_unescape_json(const char *str);

#endif /* JSON_H */