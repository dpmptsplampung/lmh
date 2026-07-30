import re
files=["src/app/api/admin/petugas/invite/invite.test.ts","src/app/api/notif/send/send.test.ts","src/app/api/notif/retry/retry.test.ts","src/app/api/investasi/lead/route.test.ts","src/app/api/umkm/inquiry/route.test.ts","src/app/api/umkm/inquiry/[id]/route.test.ts","src/app/api/umkm/request-edit-link/request-edit-link.test.ts","src/app/api/chat/ai/ai.test.ts","src/app/api/chat/ai/draft/draft.test.ts","src/app/api/chat/messages/messages.test.ts","src/app/api/admin/faq/embed/embed.test.ts","src/app/api/investment-docs/page-image/page-image.test.ts","src/proxy.test.ts","src/app/api/investment-docs/upload/upload.test.ts"]
import re
for fpath in files:
    c=open(fpath,encoding="utf-8").read()
    orig=c
    pat=re.compile(r"  const (\\w+) = (\\w+)\\.(\\w+) as unknown as [;]+;")
    c=pat.sub(lambda m: "  const "+m.group(1)+" = vi.mocked("+m.group(2)+"."+m.group(3)+");",c)
    if c!=orig:
        open(fpath,"w",encoding="utf-8").write(c)
        print("FIXED: "+fpath)
    else:
        print("unchanged: "+fpath)
print("done")
