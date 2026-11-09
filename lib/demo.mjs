// 示例书架：未接入微信读书时展示，让版面先立起来。
// 格式：书名|作者|页数|分类slug|状态(r=读完 c=在读 t=想读)|进度

const RAW = `
思想与认知
思考，快与慢|丹尼尔·卡尼曼|418|mind|read
意识的解释|丹尼尔·丹尼特|640|mind|read
行为|罗伯特·萨波尔斯基|790|mind|reading|34
确定性的终结|伊利亚·普里戈金|280|mind|to-read
心智的构建|克里斯·弗里斯|300|mind|to-read
我们时代的神经症人格|卡伦·霍妮|260|mind|read
洞察力的秘密|加里·克莱因|280|mind|to-read
笛卡尔的错误|安东尼奥·达马西奥|380|mind|read
---

科学与宇宙
时间简史|史蒂芬·霍金|210|science|read
宇宙的琴弦|布赖恩·格林|480|science|to-read
费曼物理学讲义|理查德·费曼|560|science|read
七堂极简物理课|卡洛·罗韦利|120|science|read
直到时间的尽头|布赖恩·格林|420|science|reading|61
上帝掷骰子吗|曹天元|380|science|read
暗物质与恐龙|丽莎·兰道尔|340|science|to-read
物理学的进化|爱因斯坦 / 英费尔德|240|science|to-read
现实不似你所见|卡洛·罗韦利|220|science|read
---

数学与概率
概率论沉思录|埃德温·杰恩斯|760|math|to-read
黑天鹅|纳西姆·塔勒布|420|math|read
随机漫步的傻瓜|纳西姆·塔勒布|260|math|read
数学之美|吴军|320|math|read
哥德尔、艾舍尔、巴赫|侯世达|860|math|reading|22
统计陷阱|达莱尔·哈夫|160|math|read
素数之恋|约翰·德比希尔|360|math|to-read
---

生命与演化
自私的基因|理查德·道金斯|496|life|read
物种起源|查尔斯·达尔文|520|life|to-read
生命的跃升|尼克·莱恩|340|life|read
复杂|梅拉妮·米歇尔|420|life|reading|45
病毒星球|卡尔·齐默|180|life|read
万物简史|比尔·布莱森|540|life|read
第三种黑猩猩|贾雷德·戴蒙德|420|life|to-read
---

商业与创造
从0到1|彼得·蒂尔|240|biz|read
创业维艰|本·霍洛维茨|300|biz|read
精益创业|埃里克·莱斯|280|biz|read
纳瓦尔宝典|埃里克·乔根森|260|biz|read
重来|贾森·弗里德|280|biz|read
设计中的设计|原研哉|300|biz|to-read
创新者的窘境|克莱顿·克里斯坦森|320|biz|to-read
疯狂的简洁|肯·西格尔|220|biz|read
---

经济与社会
国富论|亚当·斯密|780|econ|to-read
二十一世纪资本论|托马斯·皮凯蒂|680|econ|to-read
贫穷的本质|阿比吉特·班纳吉|400|econ|read
魔鬼经济学|史蒂芬·列维特|320|econ|read
大衰退|辜朝明|280|econ|read
好的资本主义，坏的资本主义|威廉·鲍莫尔|260|econ|to-read
---

历史
第三帝国的兴亡|威廉·夏伊勒|1200|history|to-read
奥斯维辛|劳伦斯·里斯|420|history|read
耳语者|奥兰多·费吉斯|640|history|reading|18
人类简史|尤瓦尔·赫拉利|440|history|read
丝绸之路|彼得·弗兰科潘|600|history|to-read
叫魂|孔飞力|360|history|read
---

文学
百年孤独|加西亚·马尔克斯|360|fiction|read
献给阿尔吉侬的花束|丹尼尔·凯斯|320|fiction|read
三体|刘慈欣|320|fiction|read
黑暗的左手|厄休拉·勒古恩|340|fiction|to-read
我的阿勒泰|李娟|260|fiction|read
当我们谈论爱情时我们在谈论什么|雷蒙德·卡佛|240|fiction|to-read
你一生的故事|特德·姜|280|fiction|read
---

医学与身体
我们为什么会生病|兰道夫·内塞|320|medicine|to-read
众病之王|悉达多·穆克吉|580|medicine|read
最好的告别|阿图·葛文德|300|medicine|read
免疫|尤拉·比斯|260|medicine|to-read
肠子的小心思|朱莉娅·恩德斯|240|medicine|read
医生的精进|阿图·葛文德|280|medicine|to-read
---

随笔与杂项
阅读是一座随身携带的避难所|毛姆|280|misc|read
小说稗类|张大春|300|misc|to-read
反对阐释|苏珊·桑塔格|340|misc|to-read
我的精神家园|王小波|280|misc|read
沉默的大多数|王小波|300|misc|read
重读|唐诺|360|misc|reading|51
`;

const CATS = {
  mind: '思想与认知',
  science: '科学与宇宙',
  math: '数学与概率',
  life: '生命与演化',
  biz: '商业与创造',
  econ: '经济与社会',
  history: '历史',
  fiction: '文学',
  medicine: '医学与身体',
  misc: '随笔与杂项',
};

const DESC = {
  mind: '脑、意识、自由意志，以及人如何解释自己',
  science: '物理、宇宙与那些把世界问到底的人',
  math: '概率、统计，以及它们怎样骗人',
  life: '演化、深时与活着的机器',
  biz: '从零开始，把它做出来',
  econ: '钱、激励与政策',
  history: '权力、灾难与普通人的证词',
  fiction: '小说，和一些不太像小说的东西',
  medicine: '身体、疾病与如何告别',
  misc: '放不进别处的那些',
};

export function demoLibrary() {
  const books = [];
  let order = 0;
  const hashOf = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  };
  for (const line of RAW.split('\n')) {
    const t = line.trim();
    if (!t || t === '---') continue;
    const p = t.split('|');
    if (p.length < 5) continue;
    const [title, author, pages, cat, st, prog] = p;
    const status = st === 'read' ? 'read' : st === 'reading' ? 'reading' : 'to-read';
    order += 1;
    // 演示态也想要「评分辉光」：给每本一个确定性的推荐值（6.5–9.6）和评分数
    const r = 65 + (hashOf(title) % 31);
    books.push({
      id: 'demo-' + order,
      title,
      author,
      pages: Number(pages) || 260,
      category: cat,
      categoryName: CATS[cat] || cat,
      status,
      progress: status === 'read' ? 100 : status === 'reading' ? Number(prog) || 20 : 0,
      // 让「最近在读」有排序感
      readAt: status === 'to-read' ? null : Date.now() - order * 86400000 * 3,
      finish: status === 'read' ? 1 : 0,
      rating: r / 10,
      ratingCount: 500 + (hashOf(author) % 4200),
      link: null,
      cover: null,
      source: 'demo',
    });
  }

  const seen = [];
  for (const b of books) if (!seen.includes(b.category)) seen.push(b.category);
  const categories = seen.map((slug) => ({
    slug,
    name: CATS[slug] || slug,
    description: DESC[slug] || '',
    count: books.filter((b) => b.category === slug).length,
  }));

  // 在读的书排在前面，书架开头就是「手上这本」
  books.sort((a, b) => (b.readAt || 0) - (a.readAt || 0));

  return {
    source: 'demo',
    generatedAt: new Date().toISOString(),
    categories,
    books,
  };
}

// 演示态的「笔记概览」：挑几本有笔记/想法的书，让书口的小纸条能露出来。
export function demoNotebooks() {
  const pick = {
    1: { n: 18, t: 4, m: 18, p: 100 }, // 思考，快与慢
    3: { n: 9, t: 2, m: 9, p: 34 }, // 行为
    8: { n: 0, t: 6, m: 0, p: 0 }, // 确定性的终结（只有想法）
    17: { n: 12, t: 1, m: 12, p: 100 }, // 时间简史
    21: { n: 5, t: 3, m: 5, p: 61 }, // 直到时间的尽头
    33: { n: 22, t: 7, m: 22, p: 22 }, // 哥德尔、艾舍尔、巴赫
    42: { n: 7, t: 0, m: 7, p: 45 }, // 复杂
    71: { n: 14, t: 5, m: 14, p: 100 }, // 人类简史
    78: { n: 0, t: 3, m: 0, p: 100 }, // 百年孤独（只有想法）
    102: { n: 11, t: 2, m: 11, p: 51 }, // 重读
  };
  const out = {};
  for (const [k, v] of Object.entries(pick)) out['demo-' + k] = v;
  return out;
}
