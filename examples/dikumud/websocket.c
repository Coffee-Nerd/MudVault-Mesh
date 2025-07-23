/*
 * WebSocket Implementation for MudVault Mesh DikuMUD Integration
 * 
 * This file provides a simple WebSocket client implementation for connecting
 * to the MudVault Mesh gateway. It handles the WebSocket handshake and framing.
 */

#include "sysdep.h"
#include "structs.h"
#include "utils.h"
#include "mudvault_mesh.h"

#include <sys/socket.h>
#include <netinet/in.h>
#include <netdb.h>
#include <fcntl.h>
#include <openssl/sha.h>  /* You may need to link against OpenSSL */
#include <openssl/bio.h>
#include <openssl/evp.h>
#include <openssl/buffer.h>

/* WebSocket constants */
#define WS_MAGIC_STRING "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
#define WS_OPCODE_TEXT 0x1
#define WS_OPCODE_CLOSE 0x8
#define WS_OPCODE_PING 0x9
#define WS_OPCODE_PONG 0xA

/* WebSocket frame structure */
typedef struct {
    unsigned char fin:1;
    unsigned char rsv1:1;
    unsigned char rsv2:1;
    unsigned char rsv3:1;
    unsigned char opcode:4;
    unsigned char mask:1;
    unsigned char payload_len:7;
} ws_frame_header_t;

/* =================================================================== */
/* UTILITY FUNCTIONS                                                  */
/* =================================================================== */

/*
 * Base64 encode function
 */
static char *base64_encode(const unsigned char *input, int length) {
    BIO *bmem, *b64;
    BUF_MEM *bptr;
    
    b64 = BIO_new(BIO_f_base64());
    bmem = BIO_new(BIO_s_mem());
    b64 = BIO_push(b64, bmem);
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    BIO_write(b64, input, length);
    BIO_flush(b64);
    BIO_get_mem_ptr(b64, &bptr);
    
    char *result = malloc(bptr->length + 1);
    memcpy(result, bptr->data, bptr->length);
    result[bptr->length] = 0;
    
    BIO_free_all(b64);
    return result;
}

/*
 * Generate WebSocket key
 */
static char *generate_websocket_key(void) {
    unsigned char key[16];
    int i;
    
    /* Generate random 16-byte key */
    srand(time(NULL));
    for (i = 0; i < 16; i++) {
        key[i] = rand() % 256;
    }
    
    return base64_encode(key, 16);
}

/*
 * Calculate WebSocket accept hash
 */
static char *calculate_accept_hash(const char *key) {
    char *combined;
    unsigned char hash[SHA_DIGEST_LENGTH];
    SHA_CTX sha_ctx;
    
    /* Combine key with magic string */
    combined = malloc(strlen(key) + strlen(WS_MAGIC_STRING) + 1);
    strcpy(combined, key);
    strcat(combined, WS_MAGIC_STRING);
    
    /* Calculate SHA-1 hash */
    SHA1_Init(&sha_ctx);
    SHA1_Update(&sha_ctx, combined, strlen(combined));
    SHA1_Final(hash, &sha_ctx);
    
    free(combined);
    
    /* Base64 encode the hash */
    return base64_encode(hash, SHA_DIGEST_LENGTH);
}

/* =================================================================== */
/* WEBSOCKET FUNCTIONS                                                */
/* =================================================================== */

/*
 * Connect to WebSocket server
 */
int imc_websocket_connect(const char *host, int port) {
    struct sockaddr_in server_addr;
    struct hostent *server;
    int sock;
    
    /* Create socket */
    sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        imc_log("Error creating socket: %s", strerror(errno));
        return -1;
    }
    
    /* Set non-blocking */
    int flags = fcntl(sock, F_GETFL, 0);
    fcntl(sock, F_SETFL, flags | O_NONBLOCK);
    
    /* Resolve hostname */
    server = gethostbyname(host);
    if (server == NULL) {
        imc_log("Error resolving hostname: %s", host);
        close(sock);
        return -1;
    }
    
    /* Set up server address */
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(port);
    memcpy(&server_addr.sin_addr.s_addr, server->h_addr, server->h_length);
    
    /* Connect */
    if (connect(sock, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        if (errno != EINPROGRESS) {
            imc_log("Error connecting to %s:%d: %s", host, port, strerror(errno));
            close(sock);
            return -1;
        }
    }
    
    /* Wait for connection to complete */
    fd_set write_fds;
    struct timeval timeout;
    int result;
    
    FD_ZERO(&write_fds);
    FD_SET(sock, &write_fds);
    timeout.tv_sec = IMC_TIMEOUT;
    timeout.tv_usec = 0;
    
    result = select(sock + 1, NULL, &write_fds, NULL, &timeout);
    if (result <= 0) {
        imc_log("Connection timeout to %s:%d", host, port);
        close(sock);
        return -1;
    }
    
    /* Check for connection errors */
    int sock_error;
    socklen_t len = sizeof(sock_error);
    if (getsockopt(sock, SOL_SOCKET, SO_ERROR, &sock_error, &len) < 0 || sock_error != 0) {
        imc_log("Connection failed to %s:%d: %s", host, port, strerror(sock_error));
        close(sock);
        return -1;
    }
    
    return sock;
}

/*
 * Perform WebSocket handshake
 */
bool imc_websocket_handshake(int sock, const char *host, int port) {
    char *key, *request, *response, *accept_hash, *expected_hash;
    char line[1024];
    int bytes_sent, bytes_read, total_read = 0;
    bool handshake_ok = FALSE;
    
    /* Generate WebSocket key */
    key = generate_websocket_key();
    if (!key) {
        imc_log("Failed to generate WebSocket key");
        return FALSE;
    }
    
    /* Build handshake request */
    request = malloc(1024);
    snprintf(request, 1024,
        "GET / HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "User-Agent: MudVault-Mesh-DikuMUD/1.0\r\n"
        "\r\n",
        host, port, key);
    
    /* Send handshake request */
    bytes_sent = send(sock, request, strlen(request), 0);
    if (bytes_sent < 0) {
        imc_log("Failed to send WebSocket handshake: %s", strerror(errno));
        free(key);
        free(request);
        return FALSE;
    }
    
    /* Read handshake response */
    response = malloc(2048);
    memset(response, 0, 2048);
    
    /* Read response with timeout */
    fd_set read_fds;
    struct timeval timeout;
    int result;
    
    FD_ZERO(&read_fds);
    FD_SET(sock, &read_fds);
    timeout.tv_sec = IMC_TIMEOUT;
    timeout.tv_usec = 0;
    
    result = select(sock + 1, &read_fds, NULL, NULL, &timeout);
    if (result <= 0) {
        imc_log("WebSocket handshake timeout");
        free(key);
        free(request);
        free(response);
        return FALSE;
    }
    
    bytes_read = recv(sock, response, 2047, 0);
    if (bytes_read <= 0) {
        imc_log("Failed to read WebSocket handshake response");
        free(key);
        free(request);
        free(response);
        return FALSE;
    }
    
    /* Check response status */
    if (strncmp(response, "HTTP/1.1 101", 12) != 0) {
        imc_log("WebSocket handshake failed: %s", response);
        free(key);
        free(request);
        free(response);
        return FALSE;
    }
    
    /* Verify Sec-WebSocket-Accept header */
    expected_hash = calculate_accept_hash(key);
    snprintf(line, sizeof(line), "Sec-WebSocket-Accept: %s", expected_hash);
    
    if (strstr(response, line) != NULL) {
        handshake_ok = TRUE;
        imc_log("WebSocket handshake successful");
    } else {
        imc_log("WebSocket handshake failed: Invalid accept hash");
    }
    
    free(key);
    free(request);
    free(response);
    free(expected_hash);
    
    return handshake_ok;
}

/*
 * Send WebSocket frame
 */
int imc_websocket_send(int sock, const char *data) {
    unsigned char *frame;
    int data_len, frame_len, bytes_sent;
    unsigned char mask[4];
    int i;
    
    if (!data) return -1;
    
    data_len = strlen(data);
    
    /* Calculate frame size */
    if (data_len < 126) {
        frame_len = 2 + 4 + data_len;  /* header + mask + data */
    } else if (data_len < 65536) {
        frame_len = 4 + 4 + data_len;  /* extended header + mask + data */
    } else {
        frame_len = 10 + 4 + data_len; /* extended header + mask + data */
    }
    
    frame = malloc(frame_len);
    if (!frame) return -1;
    
    /* Build frame header */
    frame[0] = 0x81; /* FIN=1, opcode=text */
    
    /* Generate mask */
    for (i = 0; i < 4; i++) {
        mask[i] = rand() % 256;
    }
    
    /* Set payload length and mask */
    if (data_len < 126) {
        frame[1] = 0x80 | data_len; /* MASK=1, length */
        memcpy(frame + 2, mask, 4);
        /* Copy and mask data */
        for (i = 0; i < data_len; i++) {
            frame[6 + i] = data[i] ^ mask[i % 4];
        }
    } else if (data_len < 65536) {
        frame[1] = 0x80 | 126; /* MASK=1, extended length */
        frame[2] = (data_len >> 8) & 0xFF;
        frame[3] = data_len & 0xFF;
        memcpy(frame + 4, mask, 4);
        /* Copy and mask data */
        for (i = 0; i < data_len; i++) {
            frame[8 + i] = data[i] ^ mask[i % 4];
        }
    } else {
        frame[1] = 0x80 | 127; /* MASK=1, 64-bit length */
        /* For simplicity, we only support up to 32-bit lengths */
        frame[2] = frame[3] = frame[4] = frame[5] = 0;
        frame[6] = (data_len >> 24) & 0xFF;
        frame[7] = (data_len >> 16) & 0xFF;
        frame[8] = (data_len >> 8) & 0xFF;
        frame[9] = data_len & 0xFF;
        memcpy(frame + 10, mask, 4);
        /* Copy and mask data */
        for (i = 0; i < data_len; i++) {
            frame[14 + i] = data[i] ^ mask[i % 4];
        }
    }
    
    /* Send frame */
    bytes_sent = send(sock, frame, frame_len, 0);
    if (bytes_sent < 0) {
        imc_log("Failed to send WebSocket frame: %s", strerror(errno));
    }
    
    free(frame);
    return bytes_sent;
}

/*
 * Receive WebSocket frame
 */
int imc_websocket_recv(int sock, char *buffer, int bufsize) {
    unsigned char header[14];
    int header_len = 2;
    int bytes_read, payload_len, i;
    unsigned char mask[4];
    bool masked;
    
    /* Read basic header */
    bytes_read = recv(sock, header, 2, 0);
    if (bytes_read <= 0) {
        if (bytes_read < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
            imc_log("WebSocket recv error: %s", strerror(errno));
        }
        return bytes_read;
    }
    
    if (bytes_read < 2) {
        /* Incomplete header */
        return 0;
    }
    
    /* Parse header */
    masked = (header[1] & 0x80) != 0;
    payload_len = header[1] & 0x7F;
    
    /* Handle extended payload length */
    if (payload_len == 126) {
        bytes_read = recv(sock, header + 2, 2, 0);
        if (bytes_read < 2) return 0;
        payload_len = (header[2] << 8) | header[3];
        header_len += 2;
    } else if (payload_len == 127) {
        bytes_read = recv(sock, header + 2, 8, 0);
        if (bytes_read < 8) return 0;
        /* For simplicity, only handle 32-bit lengths */
        payload_len = (header[6] << 24) | (header[7] << 16) | 
                     (header[8] << 8) | header[9];
        header_len += 8;
    }
    
    /* Read mask if present */
    if (masked) {
        bytes_read = recv(sock, mask, 4, 0);
        if (bytes_read < 4) return 0;
    }
    
    /* Check buffer size */
    if (payload_len >= bufsize) {
        imc_log("WebSocket frame too large: %d bytes", payload_len);
        return -1;
    }
    
    /* Read payload */
    bytes_read = recv(sock, buffer, payload_len, 0);
    if (bytes_read <= 0) return bytes_read;
    
    /* Unmask payload if necessary */
    if (masked) {
        for (i = 0; i < bytes_read; i++) {
            buffer[i] ^= mask[i % 4];
        }
    }
    
    /* Null-terminate */
    buffer[bytes_read] = '\0';
    
    /* Handle control frames */
    unsigned char opcode = header[0] & 0x0F;
    if (opcode == WS_OPCODE_CLOSE) {
        imc_log("WebSocket close frame received");
        return -1;
    } else if (opcode == WS_OPCODE_PING) {
        /* Respond with pong */
        /* TODO: Implement ping/pong handling */
        return 0;
    } else if (opcode == WS_OPCODE_PONG) {
        /* Pong received */
        return 0;
    }
    
    return bytes_read;
}

/*
 * Close WebSocket connection
 */
void imc_websocket_close(int sock) {
    unsigned char close_frame[2] = {0x88, 0x00}; /* Close frame */
    
    send(sock, close_frame, 2, 0);
    close(sock);
}