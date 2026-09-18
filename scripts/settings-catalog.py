"""Generate form contracts from the pinned GoToSocial OpenAPI source.

Run with Python + PyYAML. Labels and page organization are maintained separately.
This does not expose an API explorer in the product.
"""
import json
import os
from pathlib import Path
import yaml

source = Path(os.environ.get('GTS_SOURCE', '/tmp/weave-gts-release'))
schema = yaml.safe_load((source / 'docs/api/swagger.yaml').read_text())
groups = [
    ('user/profile', 'profile', 'user', ['/api/v1/accounts/update_credentials', '/api/v1/profile/']),
    ('user/migration', 'migration', 'user', ['/api/v1/accounts/alias', '/api/v1/accounts/move']),
    ('user/export-import', 'dataTransfer', 'user', ['/api/v1/import', '/api/v1/exports/']),
    ('user/tokens', 'accessTokens', 'user', ['/api/v1/tokens']),
    ('user/applications', 'applications', 'user', ['/api/v1/apps']),
    ('user/relay-pushes', 'relayPushes', 'user', ['/api/v1/relay_pushes']),
    ('moderation/accounts', 'accounts', 'moderator', ['/api/v2/admin/accounts', '/api/v1/admin/accounts']),
    ('moderation/reports', 'reports', 'moderator', ['/api/v1/admin/reports']),
    ('moderation/domain-limits', 'domainLimits', 'moderator', ['/api/v1/admin/domain_limits']),
    ('moderation/domain-permissions/blocks', 'domainBlocks', 'moderator', ['/api/v1/admin/domain_blocks']),
    ('moderation/domain-permissions/allows', 'domainAllows', 'moderator', ['/api/v1/admin/domain_allows']),
    ('moderation/domain-permissions/drafts', 'permissionDrafts', 'moderator', ['/api/v1/admin/domain_permission_drafts']),
    ('moderation/domain-permissions/excludes', 'permissionExcludes', 'moderator', ['/api/v1/admin/domain_permission_excludes']),
    ('moderation/domain-permissions/subscriptions', 'permissionSubscriptions', 'moderator', ['/api/v1/admin/domain_permission_subscriptions']),
    ('admin/instance/settings', 'instanceSettings', 'admin', ['/api/v1/instance']),
    ('admin/instance/rules', 'instanceRules', 'admin', ['/api/v1/admin/instance/rules']),
    ('admin/instances', 'knownInstances', 'admin', ['/api/v1/admin/instances']),
    ('admin/emoji/local', 'customEmoji', 'admin', ['/api/v1/admin/custom_emojis']),
    ('admin/http-header-permissions/blocks', 'headerBlocks', 'admin', ['/api/v1/admin/header_blocks']),
    ('admin/http-header-permissions/allows', 'headerAllows', 'admin', ['/api/v1/admin/header_allows']),
    ('admin/relay-actors', 'relayActors', 'admin', ['/api/v1/admin/relay_actors']),
    ('admin/relay-subscriptions', 'relaySubscriptions', 'admin', ['/api/v1/admin/relay_subscriptions']),
    ('admin/actions/email', 'testEmail', 'admin', ['/api/v1/admin/email/test']),
    ('admin/actions/media', 'mediaMaintenance', 'admin', ['/api/v1/admin/media_']),
    ('admin/actions/keys', 'expireKeys', 'admin', ['/api/v1/admin/domain_keys_expire']),
    ('admin/debug/apurl', 'inspectFederation', 'admin', ['/api/v1/debug/apurl']),
    ('admin/debug/caches', 'clearCaches', 'admin', ['/api/v1/debug/caches/clear']),
]

def field(parameter):
    result = {key: parameter[key] for key in ['name', 'in', 'type', 'required', 'enum', 'minimum', 'maximum', 'default', 'collectionFormat', 'items'] if key in parameter}
    result.setdefault('type', 'string')
    enums = {
        'media_policy': ['no_action', 'mark_sensitive', 'reject'],
        'follows_policy': ['no_action', 'manual_approval', 'reject_non_mutual', 'reject_all'],
        'statuses_policy': ['no_action', 'filter_warn', 'filter_hide'],
        'accounts_policy': ['no_action', 'mute'],
        'permission_type': ['block', 'allow'],
        'source[privacy]': ['public', 'unlisted', 'private', 'direct'],
        'source[status_content_type]': ['text/plain', 'text/markdown'],
        'web_visibility': ['public', 'unlisted', 'none'],
        'web_layout': ['microblog', 'gallery'],
        'data_type': ['following', 'blocks', 'mutes'],
        'mode': ['merge', 'overwrite'],
    }
    if result['name'] in enums:
        result['enum'] = enums[result['name']]
    return result

pages = []
for route, title, role, prefixes in groups:
    operations = []
    for path, methods in schema['paths'].items():
        if not any(path == p or path.startswith(p + '/') or (p.endswith(('/', '_')) and path.startswith(p)) for p in prefixes):
            continue
        if path == '/api/v1/admin/accounts':
            continue
        if title == 'instanceSettings' and path != '/api/v1/instance':
            continue
        path = path.replace('${id}', '{id}')
        for method, operation in methods.items():
            if method not in ['get', 'post', 'patch', 'put', 'delete']:
                continue
            if path == '/api/v1/instance' and method == 'get':
                continue
            parameters = operation.get('parameters', [])
            fields = []
            for p in parameters:
                if p['in'] == 'body':
                    body = p.get('schema', {})
                    if '$ref' in body:
                        body = schema['definitions'][body['$ref'].split('/')[-1]]
                    for name, value in body.get('properties', {}).items():
                        fields.append(field(dict(value, name=name, required=name in body.get('required', []), **{'in': 'body'})))
                else:
                    fields.append(field(p))
            # The release Swagger incorrectly describes this Go []string as a string.
            # internal/api/model/account.go: AccountAliasRequest.
            if path == '/api/v1/accounts/alias':
                fields = [{'name': 'also_known_as_uris', 'in': 'body', 'type': 'array'}]
            operations.append({'key': operation.get('operationId', method + path), 'method': method.upper(), 'path': path, 'fields': fields, 'produces': operation.get('produces', ['application/json'])})
    if operations:
        pages.append({'route': '/settings/' + route, 'title': title, 'role': role, 'operations': operations})

Path('src/lib/settings-catalog.json').write_text(json.dumps(pages, ensure_ascii=False, indent=2) + '\n')
print(f'{len(pages)} settings groups, {sum(len(p["operations"]) for p in pages)} operations')
