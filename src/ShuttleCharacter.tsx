import { useId } from 'react';
import type { MascotMood } from './mascot';

/** Layered vector artwork stays crisp on phones; each limb/feather animates independently. */
export function ShuttleCharacter({ mood = 'idle' }: { mood?: MascotMood }) {
  const uid = useId().replace(/:/g, '');
  const id = (name: string) => `${uid}-${name}`;
  return (
    <svg
      className={`shuttle-character mood-${mood}`}
      viewBox="0 0 200 210"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={id('feather')}
          x1="70"
          y1="30"
          x2="125"
          y2="135"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFDF6" />
          <stop offset=".56" stopColor="#F6F7E9" />
          <stop offset="1" stopColor="#BDCFB8" />
        </linearGradient>
        <linearGradient
          id={id('cork')}
          x1="80"
          y1="120"
          x2="131"
          y2="181"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFEF2" />
          <stop offset=".55" stopColor="#F7EBCD" />
          <stop offset="1" stopColor="#D5C49B" />
        </linearGradient>
        <linearGradient
          id={id('band')}
          x1="68"
          y1="120"
          x2="137"
          y2="139"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#174F3D" />
          <stop offset=".53" stopColor="#357557" />
          <stop offset="1" stopColor="#123B2D" />
        </linearGradient>
        <linearGradient
          id={id('racket')}
          x1="142"
          y1="93"
          x2="177"
          y2="131"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#E8FC97" />
          <stop offset="1" stopColor="#A5CD43" />
        </linearGradient>
        <pattern
          id={id('strings')}
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-19)"
        >
          <path d="M0 0H7M0 0V7" stroke="#659476" strokeWidth=".7" />
        </pattern>
      </defs>
      <ellipse
        className="shuttle-shadow"
        cx="100"
        cy="192"
        rx="34"
        ry="6"
        fill="#133C2B"
        opacity=".15"
      />
      <g className="shuttle-body">
        <g className="shuttle-feathers">
          <g className="shuttle-feather feather-outer-left">
            <path
              d="M80 127C64 107 35 66 37 48C39 32 52 40 64 54C78 71 92 106 94 124Z"
              fill={`url(#${id('feather')})`}
              stroke="#44644E"
              strokeWidth="2.3"
              strokeLinejoin="round"
            />
            <path
              d="M49 51L86 121M55 68L66 69M65 88L75 89"
              stroke="#A0B59B"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </g>
          <g className="shuttle-feather feather-outer-right">
            <path
              d="M120 127C136 107 165 66 163 48C161 32 148 40 136 54C122 71 108 106 106 124Z"
              fill={`url(#${id('feather')})`}
              stroke="#44644E"
              strokeWidth="2.3"
              strokeLinejoin="round"
            />
            <path
              d="M151 51L114 121M145 68L134 69M135 88L125 89"
              stroke="#A0B59B"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </g>
          <g className="shuttle-feather feather-left">
            <path
              d="M85 127C73 105 55 53 61 32C65 16 77 23 86 44C94 65 99 105 98 125Z"
              fill={`url(#${id('feather')})`}
              stroke="#44644E"
              strokeWidth="2.3"
            />
            <path
              d="M70 34L91 120M74 52L83 56M78 74L88 79"
              stroke="#A0B59B"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M66 36C65 45 70 61 72 65"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              opacity=".8"
            />
          </g>
          <g className="shuttle-feather feather-right">
            <path
              d="M115 127C127 105 145 53 139 32C135 16 123 23 114 44C106 65 101 105 102 125Z"
              fill={`url(#${id('feather')})`}
              stroke="#44644E"
              strokeWidth="2.3"
            />
            <path
              d="M130 34L109 120M126 52L117 56M122 74L112 79"
              stroke="#A0B59B"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </g>
          <g className="shuttle-feather feather-center">
            <path
              d="M93 126C87 101 82 43 91 22C96 9 104 9 109 22C118 43 113 101 107 126Z"
              fill={`url(#${id('feather')})`}
              stroke="#44644E"
              strokeWidth="2.3"
            />
            <path
              d="M100 27V119M92 48L100 55L108 48M92 71L100 78L108 71M94 95L100 101L106 95"
              stroke="#A0B59B"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M96 27C92 39 93 50 93 53"
              stroke="white"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity=".9"
            />
          </g>
          <path
            d="M60 91Q100 111 140 91M68 109Q100 122 132 109"
            stroke="#A1B398"
            strokeWidth="2"
            opacity=".8"
          />
        </g>
        <g className="shuttle-arm arm-left">
          <path
            d="M72 144C57 147 51 141 47 132"
            stroke="#244D39"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M46 135C39 131 38 125 43 124C41 117 46 114 50 121C54 116 60 119 56 125C60 129 53 136 46 135Z"
            fill="#FAF0D5"
            stroke="#244D39"
            strokeWidth="2"
          />
        </g>
        <g className="shuttle-arm arm-right">
          <path
            d="M129 145C143 149 148 140 153 132"
            stroke="#244D39"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <g transform="rotate(20 161 120)">
            <path
              d="M160 128V158"
              stroke="#244D39"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path
              d="M160 146V157"
              stroke="#D5ED70"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <ellipse
              cx="160"
              cy="111"
              rx="16"
              ry="22"
              fill="#F1F6D7"
              stroke="#244D39"
              strokeWidth="5"
            />
            <ellipse
              cx="160"
              cy="111"
              rx="13"
              ry="19"
              fill={`url(#${id('strings')})`}
              stroke={`url(#${id('racket')})`}
              strokeWidth="3"
            />
          </g>
          <path
            d="M146 140C143 135 145 129 149 130C153 125 159 128 156 133C160 138 151 145 146 140Z"
            fill="#FAF0D5"
            stroke="#244D39"
            strokeWidth="2"
          />
        </g>
        <g className="shuttle-feet">
          <path
            d="M84 175L80 183M115 175L120 183"
            stroke="#244D39"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M83 181C76 176 64 181 65 186C65 190 81 190 86 187Z"
            fill="#FAFBDF"
            stroke="#244D39"
            strokeWidth="2.3"
          />
          <path
            d="M117 181C124 176 136 181 135 186C135 190 119 190 114 187Z"
            fill="#FAFBDF"
            stroke="#244D39"
            strokeWidth="2.3"
          />
        </g>
        <path
          d="M70 125H130L134 146C137 171 120 181 100 181C80 181 63 171 66 146Z"
          fill={`url(#${id('cork')})`}
          stroke="#244D39"
          strokeWidth="2.5"
        />
        <path
          d="M69 125Q100 131 131 125L133 136Q100 143 67 136Z"
          fill={`url(#${id('band')})`}
          stroke="#244D39"
          strokeWidth="2"
        />
        <path
          d="M77 131Q100 135 123 131"
          stroke="#C9EA7D"
          strokeWidth="1.3"
          opacity=".75"
          strokeLinecap="round"
        />
        <path
          d="M72 146C70 155 74 166 80 168"
          stroke="#FFFDF5"
          strokeWidth="4"
          strokeLinecap="round"
          opacity=".8"
        />
        <ellipse cx="80" cy="159" rx="7" ry="3.8" fill="#EBA28E" opacity=".6" />
        <ellipse
          cx="120"
          cy="159"
          rx="7"
          ry="3.8"
          fill="#EBA28E"
          opacity=".6"
        />
        {mood === 'angry' ? (
          <g
            className="shuttle-angry-face"
            stroke="#244D39"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M80 141L94 147M106 147L120 141"
              stroke="#834632"
              strokeWidth="3.4"
            />
            <path d="M83 151L92 153M108 153L117 151" strokeWidth="3" />
            <path
              d="M92 163Q100 158 108 163L106 168H94Z"
              fill="#FFFDF5"
              strokeWidth="2"
            />
            <path d="M100 162V168" strokeWidth="1.3" />
            <path
              d="M123 140L126 143M126 137L129 140"
              stroke="#DF856F"
              strokeWidth="1.8"
            />
          </g>
        ) : mood === 'cheeky' ? (
          <g
            className="shuttle-cheeky-face"
            stroke="#244D39"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M82 143L92 145M109 144L118 141" strokeWidth="2" />
            <ellipse
              cx="88"
              cy="152"
              rx="3"
              ry="4"
              fill="#244D39"
              stroke="none"
            />
            <circle cx="89" cy="150.5" r="1" fill="white" stroke="none" />
            <path d="M107 153L112 149L117 153M92 160Q100 168 109 159" />
            <path
              d="M100 164L107 162L107 166C107 173 100 173 100 167Z"
              fill="#EF9B9B"
              strokeWidth="1.5"
            />
            <path d="M104 165V168" stroke="#C66E80" strokeWidth="1" />
          </g>
        ) : mood === 'cool' ? (
          <g
            className="shuttle-cool-face"
            stroke="#173E32"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M76 146L81 147M119 147L124 145M96 149Q100 146 104 149" />
            <path
              d="M80 146L96 147L95 154Q88 162 81 154ZM104 147L120 146L119 154Q112 161 105 154Z"
              fill="#214E43"
            />
            <path
              className="shuttle-shades-glint"
              d="M84 148L89 154M89 148L92 152M108 149L112 154"
              stroke="#D9F1B7"
              strokeWidth="1.5"
            />
            <path d="M94 163Q102 168 109 160" />
            <path d="M104 163L108 162" stroke="#FFFDF5" strokeWidth="1.8" />
          </g>
        ) : mood === 'dizzy' ? (
          <g
            stroke="#244D39"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <g className="shuttle-spiral">
              <path d="M88 152C86 152 86 155 89 155C94 155 94 148 88 148C80 148 81 159 89 158" />
            </g>
            <g className="shuttle-spiral">
              <path d="M112 152C110 152 110 155 113 155C118 155 118 148 112 148C104 148 105 159 113 158" />
            </g>
            <path d="M94 164L98 161L102 165L107 162" />
            <path
              className="shuttle-sweat"
              d="M135 141C135 141 129 148 130 152C132 159 140 155 139 151C139 147 135 141 135 141Z"
              fill="#92CED3"
              stroke="#4D8E91"
              strokeWidth="1.5"
            />
            <path d="M133 149L132 152" stroke="white" strokeWidth="1.5" />
          </g>
        ) : mood === 'love' ? (
          <g strokeLinecap="round" strokeLinejoin="round">
            <g
              className="shuttle-heart-eyes"
              fill="#DF7B8A"
              stroke="#B85871"
              strokeWidth="1.2"
            >
              <path d="M88 158L81 151C77 145 85 142 88 147C92 142 99 146 95 151Z" />
              <path d="M112 158L105 151C101 145 109 142 112 147C116 142 123 146 119 151Z" />
            </g>
            <path
              d="M95 163Q100 170 105 163"
              fill="#244D39"
              stroke="#244D39"
              strokeWidth="2"
            />
          </g>
        ) : mood === 'happy' ? (
          <g stroke="#244D39" strokeWidth="3" strokeLinecap="round">
            <path d="M83 153Q88 145 93 153M107 153Q112 145 117 153" />
            <path
              d="M93 160Q100 170 107 160"
              fill="#244D39"
              strokeLinejoin="round"
            />
            <path
              d="M97 164Q100 162 103 164"
              stroke="#E9A49B"
              strokeWidth="2"
            />
          </g>
        ) : (
          <>
            <g className="shuttle-eyes">
              <ellipse cx="88" cy="152" rx="3.2" ry="4.5" fill="#244D39" />
              <ellipse cx="112" cy="152" rx="3.2" ry="4.5" fill="#244D39" />
              <circle cx="89" cy="150.5" r="1" fill="white" />
              <circle cx="113" cy="150.5" r="1" fill="white" />
            </g>
            {mood === 'remind' ? (
              <>
                <path
                  d="M84 143L91 142M109 142L116 143"
                  stroke="#244D39"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <ellipse cx="100" cy="162" rx="3" ry="3.5" fill="#244D39" />
              </>
            ) : (
              <path
                d="M95 161Q100 166 105 161"
                stroke="#244D39"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            )}
          </>
        )}
      </g>
      {mood === 'angry' && (
        <g
          className="shuttle-fury"
          stroke="#D9785E"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M142 94L142 99L137 99M149 94L149 99L154 99M137 106L142 106L142 111M154 106L149 106L149 111" />
          <path
            className="shuttle-steam"
            d="M42 110C34 104 48 99 40 92M162 82C170 76 157 71 164 65"
            stroke="#C9B493"
            strokeWidth="2"
          />
        </g>
      )}
      {mood === 'love' && (
        <g
          className="shuttle-love-hearts"
          fill="#E79AA5"
          stroke="#BC6F83"
          strokeWidth="1.2"
          strokeLinejoin="round"
        >
          <path
            className="shuttle-floating-heart"
            d="M36 107L28 99C23 92 33 89 36 94C40 88 49 93 44 99Z"
          />
          <path
            className="shuttle-floating-heart"
            d="M165 82L159 76C155 71 162 68 165 72C168 68 175 71 171 76Z"
          />
        </g>
      )}
      {mood === 'dizzy' && (
        <g
          className="shuttle-dizzy-stars"
          fill="#D7AC50"
          stroke="#B08E3D"
          strokeWidth=".8"
        >
          <path d="M69 109L71 113L76 114L72 117L73 122L69 119L65 122L66 117L62 114L67 113Z" />
          <path d="M132 101L134 105L139 106L135 109L136 114L132 111L128 114L129 109L125 106L130 105Z" />
        </g>
      )}
      <g className="shuttle-sparkles" fill="#BAD953">
        <path d="M27 85L30 92L37 95L30 98L27 105L24 98L17 95L24 92Z" />
        <path d="M171 44L173 49L178 51L173 53L171 58L169 53L164 51L169 49Z" />
        <circle cx="154" cy="172" r="3" />
      </g>
    </svg>
  );
}
