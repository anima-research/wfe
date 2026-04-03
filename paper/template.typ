// Still Alive — custom typst template for pandoc
// Used via: pandoc --pdf-engine=typst --template=paper/pandoc-template.typ

#let conf(
  title: none,
  subtitle: none,
  authors: (),
  date: none,
  abstract: none,
  abstract-title: "Abstract",
  thanks: none,
  keywords: (),
  lang: "en",
  region: "US",
  margin: (x: 1.2in, y: 1.2in),
  paper: "us-letter",
  font: (),
  fontsize: 11pt,
  mathfont: (),
  codefont: (),
  linestretch: 1.15,
  sectionnumbering: none,
  pagenumbering: "1",
  linkcolor: none,
  citecolor: none,
  filecolor: none,
  cols: 1,
  doc,
) = {
  // -- Page setup --
  set page(
    paper: paper,
    margin: margin,
    numbering: pagenumbering,
    header: context {
      if counter(page).get().first() > 1 {
        set text(8pt, fill: luma(140))
        [Still Alive — Anima Labs]
        h(1fr)
        [#counter(page).display()]
      }
    },
    footer: none,
  )

  set par(justify: true, leading: 0.65em * linestretch, first-line-indent: 0pt)
  set text(font: if font.len() > 0 { font } else { ("Libertinus Serif", "Linux Libertine", "Georgia", "Times New Roman") }, size: fontsize, lang: lang, region: region)
  set heading(numbering: sectionnumbering)

  // -- Link styling --
  show link: set text(fill: rgb("#335"))

  // -- Heading styles --
  show heading.where(level: 1): it => {
    set text(16pt, weight: "bold", fill: rgb("#1a1a2a"))
    v(1.2em)
    block(it)
    v(0.5em)
  }

  show heading.where(level: 2): it => {
    set text(12pt, weight: "bold", fill: rgb("#2a2a3a"))
    v(0.8em)
    block(it)
    v(0.3em)
  }

  show heading.where(level: 3): it => {
    set text(11pt, weight: "bold", fill: rgb("#3a3a4a"))
    v(0.6em)
    block(it)
    v(0.2em)
  }

  // -- Table styling --
  set table(
    inset: (x: 8pt, y: 5pt),
    stroke: none,
  )
  show table: set text(9.5pt)

  // -- Block quote styling (used for callouts) --
  show quote: it => {
    block(
      width: 100%,
      inset: (left: 14pt, right: 12pt, top: 10pt, bottom: 10pt),
      stroke: (left: 2pt + rgb("#556")),
      fill: rgb("#f5f5f8"),
      radius: (right: 3pt),
      it.body,
    )
  }

  // -- Code styling --
  show raw.where(block: false): box.with(
    fill: luma(240),
    inset: (x: 3pt, y: 0pt),
    outset: (y: 3pt),
    radius: 2pt,
  )

  // -- Figure styling --
  show figure.where(kind: image): set figure.caption(position: bottom)
  show figure.caption: set text(9pt, style: "italic", fill: luma(80))

  // ========================================
  // Title page
  // ========================================
  {
    set page(numbering: none, header: none)

    v(2.5in)

    align(center)[
      #text(28pt, weight: "bold", fill: rgb("#1a1a2a"))[#title]

      #if subtitle != none {
        v(0.3em)
        text(14pt, fill: rgb("#555"))[#subtitle]
      }

      #v(1.5em)
      #line(length: 30%, stroke: 0.5pt + rgb("#aab"))
      #v(1.5em)

      // Authors
      #for author in authors {
        text(12pt)[#author.name]
        if author.affiliation != "" {
          linebreak()
          text(10pt, fill: luma(100))[#author.affiliation]
        }
        v(0.3em)
      }

      #v(1em)
      #if date != none {
        text(11pt, fill: luma(120))[#date]
      }
    ]

    pagebreak()
  }

  // ========================================
  // Body
  // ========================================
  if cols == 1 {
    doc
  } else {
    columns(cols, doc)
  }
}
